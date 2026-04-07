import { type AppEntry, displayName } from '../../data'
import './styles.css'

interface ProductCardProps {
  app: AppEntry
  index: number
  onClick: (label: string) => void
}

export function ProductCard({ app, index, onClick }: ProductCardProps) {
  const instant = index < 0
  const delay = instant ? 0 : Math.min(index * 60, 400)
  const name = displayName(app)
  const letter = name[0].toLowerCase()

  return (
    <div
      class={`product-card${instant ? ' product-card--instant' : ''}`}
      style={`animation-delay: ${delay}ms`}
      data-label={app.label}
      tabIndex={0}
      onClick={() => onClick(app.label)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(app.label)
        }
      }}
    >
      <div class='product-card__thumb'>
        <span class='product-card__letter'>{letter}</span>
      </div>
      <div class='product-card__body'>
        <span class='product-card__name'>{name}</span>
        <p class='product-card__desc'>{app.description}</p>
      </div>
    </div>
  )
}
