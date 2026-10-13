import ProductCard from '../ProductCard/ProductCard.tsx'
import type { Product } from '../../data/products.ts'
import type { ProductRelevance } from '../../service/jev.ts'
import styles from './ProductGrid.module.scss'

type ProductGridProps = {
  products: Product[]
  /** Produtos sugeridos pelo JEV, indexados por id. */
  relevanceById?: Map<string, ProductRelevance>
}

export default function ProductGrid({
  products,
  relevanceById,
}: ProductGridProps) {
  if (products.length === 0) {
    return <p className={styles.empty}>Nenhum produto disponível.</p>
  }

  return (
    <ul className={styles.grid}>
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            relevance={relevanceById?.get(product.id)}
          />
        </li>
      ))}
    </ul>
  )
}
