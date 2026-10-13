import axios, { isAxiosError, type AxiosInstance } from 'axios'
import type { Product } from '../data/products.ts'

/**
 * Integração com a core API da TypeSafe (JEV) — primitiva `score`.
 * https://docs.typesafe.ai/primitives/score
 *
 * Uso nesta POC: o cliente descreve em linguagem natural a intenção da compra
 * ("vou passar o fim de semana na praia com as crianças") e o JEV pontua, para
 * cada produto do catálogo, quão relacionado ele está com essa intenção.
 * Os produtos melhor pontuados viram sugestões de compra.
 */

/**
 * A API recusa chamadas de origem browser ("Disallowed CORS origin"), então
 * em dev o front fala com o proxy do Vite, que injeta a credencial e encaminha
 * para https://api.typesafe.ai/v1. Ver `server.proxy` em vite.config.ts.
 */
const DEFAULT_BASE_URL = '/jev'
const DEFAULT_MODEL = 'jev-latest'
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * A primitiva `score` avalia todas as questões de uma requisição em paralelo:
 * "adicionar questões quase não muda o tempo de resposta". Por isso cada
 * requisição carrega um lote de produtos, e não um produto só.
 */
const DEFAULT_BATCH_SIZE = 25

/**
 * Preço do Jev 1.13: "$42 / $0.042" por Btok / Mtok, cobrado por token de
 * entrada — tokens de saída são gratuitos. https://docs.typesafe.ai/models
 */
export const JEV_USD_PER_INPUT_MTOK = 0.042

/**
 * Caracteres por token do payload serializado. Calibrado contra o `usage` real
 * da API para este formato (JSON + texto pt-BR): 143.320 caracteres saíram por
 * 50.546 tokens de entrada. O valor genérico de 4 subestimava em ~30%.
 */
const CHARS_PER_TOKEN = 2.84

function usdForInputTokens(inputTokens: number): number {
  return (inputTokens / 1_000_000) * JEV_USD_PER_INPUT_MTOK
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/* -------------------------------------------------------------------------- */
/* Contrato da API                                                            */
/* -------------------------------------------------------------------------- */

type ScoreCriterion = string | { what: string; examples?: string[] }

type ScoreQuestion = {
  type: 'score'
  instructions: string
  criteria: ScoreCriterion[]
}

type SystemOneRequest = {
  state: string
  model: string
  questions: Record<string, ScoreQuestion>
}

type ScoreAnswer = {
  type: 'score'
  /** Posição no espectro de níveis: 0 a `criteria.length - 1`, podendo ser fracionário. */
  score: number
  /** 0 a 1. */
  confidence: number
  legend?: Record<string, string>
  /** Distribuição de probabilidade por nível; soma 1. */
  probabilities?: Record<string, number>
}

type SystemOneResponse = {
  model: string
  answers: Record<string, ScoreAnswer>
  usage: { input_tokens: number; output_tokens: number }
}

/* -------------------------------------------------------------------------- */
/* Escala de relevância                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Níveis ordenados do menor para o maior, como a API espera. O nível máximo
 * é `RELEVANCE_CRITERIA.length - 1`, usado para normalizar o score em 0..1.
 */
export const RELEVANCE_CRITERIA: ScoreCriterion[] = [
  {
    what: 'Nenhuma relação com a intenção descrita.',
    examples: [
      'Intenção "tratar uma gripe" e o produto é um esmalte de unha.',
      'Intenção "cuidar do bebê" e o produto é um energético.',
    ],
  },
  {
    what: 'Relação muito fraca: só coincide por ser de farmácia.',
    examples: [
      'Intenção "ir à praia" e o produto é um creme dental.',
      'Intenção "dor de cabeça" e o produto é um absorvente.',
    ],
  },
  {
    what: 'Relação indireta: pode fazer sentido em algumas situações da intenção, mas não é esperado.',
    examples: [
      'Intenção "ir à praia" e o produto é água mineral.',
      'Intenção "treinar na academia" e o produto é uma barra de proteína.',
    ],
  },
  {
    what: 'Claramente útil para a intenção: um cliente com essa intenção veria valor imediato.',
    examples: [
      'Intenção "ir à praia" e o produto é um pós-sol de aloe vera.',
      'Intenção "tratar uma gripe" e o produto é vitamina C efervescente.',
    ],
  },
  {
    what: 'Essencial para a intenção: é um dos primeiros itens que o cliente levaria.',
    examples: [
      'Intenção "ir à praia com as crianças" e o produto é protetor solar infantil FPS 60.',
      'Intenção "tratar uma gripe" e o produto é um antigripal.',
    ],
  },
]

const MAX_LEVEL = RELEVANCE_CRITERIA.length - 1

/* -------------------------------------------------------------------------- */
/* Tipos públicos                                                             */
/* -------------------------------------------------------------------------- */

export type ProductRelevance = {
  product: Product
  /** Score normalizado em 0..1 (`score / MAX_LEVEL`). */
  score: number
  /** Score cru devolvido pela API, em 0..MAX_LEVEL. */
  rawScore: number
  /** Confiança da avaliação, em 0..1. */
  confidence: number
}

export type JevUsage = {
  inputTokens: number
  outputTokens: number
  requests: number
  /** Custo real em USD, derivado dos tokens de entrada cobrados. */
  costUsd: number
}

export type CostEstimate = {
  /** Produtos que serão avaliados. */
  products: number
  /** Requisições necessárias para cobrir todos eles. */
  requests: number
  /** Tokens de entrada estimados somando todas as requisições. */
  inputTokens: number
  /** Custo estimado em USD. */
  costUsd: number
}

export type RankProductsResult = {
  intent: string
  /** Todos os produtos avaliados, do mais relacionado ao menos relacionado. */
  ranked: ProductRelevance[]
  usage: JevUsage
}

export type RankProductsOptions = {
  /** Intenção de compra descrita pelo cliente. */
  intent: string
  /** Catálogo (ou recorte dele) a ser avaliado. */
  products: Product[]
  /** Produtos por requisição. Padrão: 25. */
  batchSize?: number
  /** Permite cancelar as requisições em voo. */
  signal?: AbortSignal
}

export type SuggestOptions = RankProductsOptions & {
  /** Quantas sugestões devolver. Padrão: 6. */
  limit?: number
  /** Score normalizado mínimo para um produto ser sugerido. Padrão: 0.6. */
  minScore?: number
}

export class JevError extends Error {
  readonly status?: number
  readonly details?: unknown

  constructor(
    message: string,
    options?: { status?: number; details?: unknown },
  ) {
    super(message)
    this.name = 'JevError'
    this.status = options?.status
    this.details = options?.details
  }
}

/* -------------------------------------------------------------------------- */
/* Cliente HTTP                                                               */
/* -------------------------------------------------------------------------- */

const model = import.meta.env.VITE_JEV_MODEL ?? DEFAULT_MODEL

let client: AxiosInstance | undefined

/**
 * Sem header `Authorization`: quem assina a requisição é o proxy, para a chave
 * não acabar no bundle do navegador.
 */
function getClient(): AxiosInstance {
  client ??= axios.create({
    baseURL: DEFAULT_BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  })

  return client
}

async function systemOne(
  body: SystemOneRequest,
  signal?: AbortSignal,
): Promise<SystemOneResponse> {
  try {
    const { data } = await getClient().post<SystemOneResponse>(
      '/systemone',
      body,
      { signal },
    )
    return data
  } catch (error) {
    if (isAxiosError(error)) {
      if (error.code === 'ERR_CANCELED') throw error

      const status = error.response?.status
      const message =
        status === 401 || status === 403
          ? `JEV recusou a credencial (${status}). Confira JEV_API_KEY no .env e reinicie o dev server.`
          : status
            ? `JEV respondeu ${status} ao avaliar os produtos.`
            : `Não foi possível falar com o JEV: ${error.message}`

      throw new JevError(message, { status, details: error.response?.data })
    }

    throw new JevError('Falha inesperada ao chamar o JEV.', { details: error })
  }
}

/* -------------------------------------------------------------------------- */
/* Montagem do prompt                                                         */
/* -------------------------------------------------------------------------- */

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** Descrição textual do produto enviada ao JEV. */
function describeProduct(product: Product): string {
  const parts = [
    product.name,
    `marca ${product.brand}`,
    product.presentation,
    `categoria ${product.category}`,
    brl.format(product.price),
  ]

  if (product.prescriptionOnly) parts.push('exige receita médica')

  return parts.join(' · ')
}

/** O `state` é o conteúdo avaliado: a intenção declarada pelo cliente. */
function buildState(intent: string): string {
  return [
    'Intenção de compra declarada por um cliente de farmácia:',
    `"${intent.trim()}"`,
  ].join('\n')
}

function buildQuestion(product: Product): ScoreQuestion {
  return {
    type: 'score',
    instructions: `Quão relacionado com a intenção de compra está este produto: ${describeProduct(product)}?`,
    criteria: RELEVANCE_CRITERIA,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

type Batch = {
  /** Mapeia o id sintético da questão de volta para o produto. */
  byQuestionId: Map<string, Product>
  request: SystemOneRequest
}

/**
 * Divide o catálogo em requisições. Ids de questão sintéticos (`p0`, `p1`, ...)
 * evitam depender do formato do id do produto nas chaves do mapa de questões.
 */
function buildBatches(
  intent: string,
  products: Product[],
  batchSize: number,
): Batch[] {
  const state = buildState(intent)

  return chunk(products, Math.max(1, batchSize)).map((batch) => {
    const byQuestionId = new Map<string, Product>()
    const questions: Record<string, ScoreQuestion> = {}

    batch.forEach((product, index) => {
      const questionId = `p${index}`
      byQuestionId.set(questionId, product)
      questions[questionId] = buildQuestion(product)
    })

    return { byQuestionId, request: { state, model, questions } }
  })
}

/* -------------------------------------------------------------------------- */
/* API pública                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Estima, sem chamar a API, quanto custa classificar o catálogo inteiro contra
 * uma intenção. Monta as requisições reais e conta os caracteres do payload,
 * então o número acompanha o tamanho do lote: como o `state` é cobrado uma vez
 * por requisição, lotes maiores saem mais baratos.
 */
export function estimateRankingCost({
  intent,
  products,
  batchSize = DEFAULT_BATCH_SIZE,
}: Omit<RankProductsOptions, 'signal'>): CostEstimate {
  const batches = buildBatches(intent.trim(), products, batchSize)

  const inputTokens = batches.reduce(
    (total, { request }) => total + estimateTokens(JSON.stringify(request)),
    0,
  )

  return {
    products: products.length,
    requests: batches.length,
    inputTokens,
    costUsd: usdForInputTokens(inputTokens),
  }
}

/**
 * Pontua cada produto contra a intenção de compra e devolve o catálogo
 * ordenado do mais relacionado ao menos relacionado.
 */
export async function rankProductsByIntent({
  intent,
  products,
  batchSize = DEFAULT_BATCH_SIZE,
  signal,
}: RankProductsOptions): Promise<RankProductsResult> {
  const trimmedIntent = intent.trim()

  if (!trimmedIntent) {
    throw new JevError('Descreva a intenção da compra antes de pedir sugestões.')
  }

  const usage: JevUsage = {
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
    costUsd: 0,
  }

  if (products.length === 0) {
    return { intent: trimmedIntent, ranked: [], usage }
  }

  const batches = buildBatches(trimmedIntent, products, batchSize)

  const responses = await Promise.all(
    batches.map(async ({ byQuestionId, request }) => ({
      byQuestionId,
      response: await systemOne(request, signal),
    })),
  )

  const ranked: ProductRelevance[] = []

  for (const { byQuestionId, response } of responses) {
    usage.requests += 1
    usage.inputTokens += response.usage?.input_tokens ?? 0
    usage.outputTokens += response.usage?.output_tokens ?? 0

    for (const [questionId, product] of byQuestionId) {
      const answer = response.answers?.[questionId]

      // Produto sem resposta é ignorado em vez de derrubar o lote inteiro.
      if (!answer || typeof answer.score !== 'number') continue

      ranked.push({
        product,
        rawScore: answer.score,
        score: answer.score / MAX_LEVEL,
        confidence: answer.confidence ?? 0,
      })
    }
  }

  usage.costUsd = usdForInputTokens(usage.inputTokens)

  ranked.sort((a, b) => b.score - a.score || b.confidence - a.confidence)

  return { intent: trimmedIntent, ranked, usage }
}

/**
 * Atalho para a tela principal: devolve apenas os produtos que o JEV considerou
 * relacionados à intenção, já cortados por `limit` e `minScore`.
 */
export async function suggestRelatedProducts({
  limit = 6,
  minScore = 0.6,
  ...options
}: SuggestOptions): Promise<RankProductsResult> {
  const result = await rankProductsByIntent(options)

  return {
    ...result,
    ranked: result.ranked
      .filter((item) => item.score >= minScore)
      .slice(0, limit),
  }
}
