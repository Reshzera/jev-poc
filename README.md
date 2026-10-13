# jev-poc


### Demo



https://github.com/user-attachments/assets/5e0855ae-55d6-4f59-aecd-e0b6de9931eb








Catálogo de uma drogaria brasileira — single-page app em React + TypeScript,
Vite e SCSS modules.

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc -b
npm run build      # typecheck + build de produção em dist/
npm run preview    # serve o build
npm run lint
```

## Estrutura

```
tsconfig.json                  referencia os dois configs abaixo
tsconfig.app.json              src/ — strict, libs DOM, tipos vite/client
tsconfig.node.json             vite.config.ts — tipos de node
vite.config.ts                 sass loadPaths + proxy /jev → api.typesafe.ai
src/
  main.tsx                     entrypoint
  App.tsx                      busca por intenção + grid + rodapé
  service/jev.ts               integração com a core API da TypeSafe (JEV)
  vite-env.d.ts                tipos do Vite (inclui *.module.scss)
  data/products.ts             catálogo (tipos Product e Category)
  components/
    ProductGrid/               grid responsivo (<ul>/<li>)
    ProductCard/               card de um produto
  styles/
    _variables.scss            design tokens
    _mixins.scss               mixins compartilhados
    global.scss                reset + estilos base
```

## Dados

`src/data/products.ts` exporta 20 itens típicos de drogaria brasileira
(medicamentos, dermocosméticos, higiene, vitaminas e infantil), cada um com
`name`, `brand`, `presentation`, `category`, `price` e `prescriptionOnly`.
Os preços são formatados em BRL com `Intl.NumberFormat('pt-BR')` e itens com
`prescriptionOnly` recebem o selo "Receita".

Trocar essa constante por um `fetch` de API é a única mudança necessária para
plugar um backend — `ProductGrid` já recebe a lista por prop e trata lista
vazia.

## Sugestões por intenção (JEV)

A home tem um campo onde o cliente descreve a intenção da compra em linguagem
natural ("meu filho está com gripe e febre"). Ao enviar, `src/service/jev.ts`
pontua **todos** os produtos do catálogo contra essa intenção usando a
primitiva [`score`](https://docs.typesafe.ai/primitives/score) da core API da
TypeSafe; os mais relacionados sobem para o topo da lista com borda verde e o
percentual de relevância.

### Configuração

```bash
cp .env.example .env
# edite .env e preencha JEV_API_KEY
```

A API **recusa chamadas de origem browser** (`Disallowed CORS origin`), então o
dev server atua como proxy: o front chama `/jev/systemone` e o
`server.proxy` do `vite.config.ts` injeta o header `Authorization` e encaminha
para `https://api.typesafe.ai/v1`. A chave é lida com `loadEnv` sem o prefixo
`VITE_`, portanto **nunca entra no bundle**.

> O proxy só existe no dev server. `npm run build` gera um bundle que chama
> `/jev` — para rodar em produção é preciso um backend (ou function) que faça
> esse mesmo encaminhamento.

### Como as requisições são montadas

O `state` leva a intenção do cliente e cada produto vira uma **questão** no
mesmo request — a doc recomenda isso porque as questões são avaliadas em
paralelo e "adicionar questões quase não muda o tempo de resposta". O catálogo
é dividido em lotes de 25 produtos, então 108 produtos viram 5 requisições em
vez de 108.

A escala (`RELEVANCE_CRITERIA`) tem 5 níveis, de "nenhuma relação" a
"essencial". O score cru vem de 0 a 4 e é normalizado por `criteria.length - 1`
para 0..1; o corte para virar sugestão é 0.6.

### Custo

O Jev cobra só tokens de entrada: **$0.042 por milhão**
([models](https://docs.typesafe.ai/models)). O painel abaixo do campo mostra a
estimativa antes de enviar e o custo real depois, vindo do `usage` da resposta.
Classificar os 108 produtos custa cerca de **US$ 0,002** por intenção.

A estimativa serializa as requisições reais e divide por `CHARS_PER_TOKEN`
(2.84), valor calibrado contra o `usage` observado — fica dentro de ~1% do
cobrado.

## Estilos

Cada componente tem seu `*.module.scss` ao lado; o Vite gera class names com
hash, então não há colisão. `src/styles` está no load path do Sass
(`vite.config.ts`), então os módulos importam o código compartilhado sem
caminhos relativos:

```scss
@use 'variables' as v;
@use 'mixins' as m;

.card {
  @include m.surface;
  padding: v.$space * 2;
}
```

Estilos globais ficam só em `styles/global.scss`, importado uma vez no
`main.tsx`.

Módulos SCSS são tipados pelo `vite/client` como
`{ readonly [key: string]: string }` — os class names resolvem para `string`,
mas não são validados contra o arquivo. Para checagem por classe, use um
gerador como `typed-scss-modules`.

## TypeScript

- `strict` ligado, mais `noUnusedLocals`/`noUnusedParameters`,
  `verbatimModuleSyntax` e `erasableSyntaxOnly`.
- `allowImportingTsExtensions` ligado, então imports relativos carregam a
  extensão (`./App.tsx`). O Vite remove no build; o `tsc` não emite nada.
