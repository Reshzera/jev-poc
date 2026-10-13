import { useMemo, useRef, useState } from 'react'
import ProductGrid from './components/ProductGrid/ProductGrid.tsx'
import { products } from './data/products.ts'
import {
  estimateRankingCost,
  rankProductsByIntent,
  type ProductRelevance,
  type RankProductsResult,
} from './service/jev.ts'
import styles from './App.module.scss'

/** Score normalizado mínimo para o produto virar sugestão. */
const MIN_SCORE = 0.6
const MAX_SUGGESTIONS = 8

const integerFormat = new Intl.NumberFormat('pt-BR')

/** O custo por intenção fica na casa dos milésimos de dólar. */
function formatUsd(value: number): string {
  return value > 0 && value < 0.01
    ? `US$ ${value.toFixed(5)}`
    : `US$ ${value.toFixed(2)}`
}

export default function App() {
  const [intent, setIntent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RankProductsResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Estimativa de classificar o catálogo inteiro, recalculada conforme digita.
  const estimate = useMemo(
    () => estimateRankingCost({ intent, products }),
    [intent],
  )

  const suggestions = useMemo<ProductRelevance[]>(
    () =>
      (result?.ranked ?? [])
        .filter((item) => item.score >= MIN_SCORE)
        .slice(0, MAX_SUGGESTIONS),
    [result],
  )

  const relevanceById = useMemo(
    () => new Map(suggestions.map((item) => [item.product.id, item])),
    [suggestions],
  )

  // Sugestões primeiro, o resto do catálogo na ordem original.
  const orderedProducts = useMemo(
    () =>
      relevanceById.size === 0
        ? products
        : [
            ...suggestions.map((item) => item.product),
            ...products.filter((product) => !relevanceById.has(product.id)),
          ],
    [suggestions, relevanceById],
  )

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedIntent = intent.trim()
    if (!trimmedIntent || isLoading) return

    // Descarta uma análise anterior ainda em voo.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const next = await rankProductsByIntent({
        intent: trimmedIntent,
        products,
        signal: controller.signal,
      })

      setResult(next)
    } catch (caught) {
      if (controller.signal.aborted) return

      setResult(null)
      setError(
        caught instanceof Error
          ? caught.message
          : 'Falha inesperada ao consultar o JEV.',
      )
    } finally {
      if (!controller.signal.aborted) setIsLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.brand}>Drogaria Bom Preço</p>
          <h1 className={styles.title}>Catálogo</h1>
        </div>
        <p className={styles.count}>{products.length} produtos</p>
      </header>

      <form className={styles.intent} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="intent">
          Qual é a intenção da sua compra?
        </label>

        <div className={styles.row}>
          <input
            id="intent"
            className={styles.input}
            type="text"
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Ex.: vou passar o fim de semana na praia com as crianças"
            autoComplete="off"
            disabled={isLoading}
          />
          <button
            className={styles.submit}
            type="submit"
            disabled={isLoading || intent.trim().length === 0}
          >
            {isLoading ? 'Analisando…' : 'Sugerir produtos'}
          </button>
        </div>

        <ul className={styles.cost}>
          <li>
            <span>Produtos avaliados</span>
            <strong>{integerFormat.format(estimate.products)}</strong>
          </li>
          <li>
            <span>Requisições ao JEV</span>
            <strong>{integerFormat.format(estimate.requests)}</strong>
          </li>
          <li>
            <span>Tokens de entrada (est.)</span>
            <strong>~{integerFormat.format(estimate.inputTokens)}</strong>
          </li>
          <li>
            <span>Custo estimado</span>
            <strong className={styles.costValue}>
              {formatUsd(estimate.costUsd)}
            </strong>
          </li>
        </ul>

        {result && (
          <p className={styles.note}>
            Custo real da última análise:{' '}
            <strong>{formatUsd(result.usage.costUsd)}</strong> ·{' '}
            {integerFormat.format(result.usage.inputTokens)} tokens de entrada
            em {result.usage.requests} requisições. Tokens de saída não são
            cobrados.
          </p>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {result && suggestions.length === 0 && !error && (
          <p className={styles.note}>
            O JEV não encontrou produtos suficientemente relacionados a “
            {result.intent}”.
          </p>
        )}
      </form>

      {suggestions.length > 0 && (
        <p className={styles.resultLine}>
          {suggestions.length} sugestões para “{result?.intent}” no topo da
          lista.
        </p>
      )}

      <ProductGrid products={orderedProducts} relevanceById={relevanceById} />

      <footer className={styles.footer}>
        Preços sujeitos a alteração. Medicamentos com tarja exigem receita
        médica.
      </footer>
    </div>
  )
}
