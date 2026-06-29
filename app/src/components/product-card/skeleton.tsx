import './styles.css'

export function ProductCardSkeleton() {
  return (
    <div class='product-card product-card--skeleton' aria-hidden='true'>
      <div class='product-card__thumb' />
      <div class='product-card__body'>
        <div class='product-card__text'>
          <div class='product-card__title-row'>
            <span class='product-card__sk product-card__sk--title' />
          </div>
          <span class='product-card__sk product-card__sk--desc' />
        </div>
        <div class='product-card__footer'>
          <span class='product-card__sk product-card__sk--open' />
          <div class='product-card__footer-end'>
            <span class='product-card__sk product-card__sk--pill' />
            <span class='product-card__sk product-card__sk--circle' />
          </div>
        </div>
      </div>
    </div>
  )
}
