import type { Category, Product } from '../../data/products.ts'
import type { ProductRelevance } from '../../service/jev.ts'
import styles from './ProductCard.module.scss'

type ProductCardProps = {
  product: Product
  /** Presente quando o JEV sugeriu este produto para a intenção atual. */
  relevance?: ProductRelevance
}

const categoryLabels: Record<Category, string> = {
  medicamento: 'Medicamento',
  dermocosmetico: 'Dermocosmético',
  solar: 'Solar e Repelente',
  higiene: 'Higiene',
  beleza: 'Beleza',
  vitamina: 'Vitaminas',
  suplemento: 'Suplementos',
  bebida: 'Bebidas',
  infantil: 'Infantil',
  'primeiros-socorros': 'Primeiros Socorros',
  equipamento: 'Saúde e Medição',
  sexual: 'Saúde Sexual',
  conveniencia: 'Conveniência',
}

const categoryIcons: Record<Category, string> = {
  medicamento: '💊',
  dermocosmetico: '🧴',
  solar: '☀️',
  higiene: '🧼',
  beleza: '💄',
  vitamina: '🍊',
  suplemento: '🥤',
  bebida: '🧃',
  infantil: '🍼',
  'primeiros-socorros': '🩹',
  equipamento: '🩺',
  sexual: '💞',
  conveniencia: '🛒',
}

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export default function ProductCard({ product, relevance }: ProductCardProps) {
  const { name, brand, presentation, category, price, prescriptionOnly } =
    product

  const className = [styles.card, relevance && styles.suggested]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={className}>
      <div className={styles.thumb} aria-hidden="true">
        {categoryIcons[category]}
      </div>

      {relevance && (
        <p className={styles.relevance}>
          Sugestão · {Math.round(relevance.score * 100)}% relacionado
        </p>
      )}

      <p className={styles.category}>{categoryLabels[category]}</p>
      <h2 className={styles.name}>{name}</h2>
      <p className={styles.meta}>
        {brand} · {presentation}
      </p>

      <div className={styles.bottom}>
        <span className={styles.price}>{brl.format(price)}</span>
        {prescriptionOnly && <span className={styles.badge}>Receita</span>}
      </div>
    </article>
  )
}
