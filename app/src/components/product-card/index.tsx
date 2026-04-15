import { ThumbsUp } from 'lucide-preact'

import { type AppEntry, displayName } from '../../state/apps/types'
import { StarButton } from '../star-button'
import './styles.css'

interface ProductCardProps {
  app: AppEntry
  index: number
  starred?: boolean
  recommended?: boolean
  showStar?: boolean
  onClick: (label: string) => void
  onStar?: (label: string) => void
  onRecommend?: (label: string) => void
}

export function ProductCard({
  app,
  index,
  starred,
  recommended,
  showStar = true,
  onClick,
  onStar,
  onRecommend
}: ProductCardProps) {
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
        {onRecommend && (
          <button
            class={`product-card__social-proof${recommended ? ' product-card__social-proof--active' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onRecommend(app.label)
            }}
          >
            <ThumbsUp size={12} />
            {app.vouchCount != null && app.vouchCount >= 1 ? (
              app.vouchCount
            ) : (
              <span class='product-card__social-proof-pill'>Be the first to recommend</span>
            )}
            {app.vouchCount != null && app.vouchCount >= 1 && !recommended && (
              <span class='product-card__social-proof-pill'>Recommend</span>
            )}
          </button>
        )}
      </div>
      {showStar && onStar && (
        <div class='product-card__actions'>
          <StarButton starred={!!starred} onClick={() => onStar(app.label)} />
        </div>
      )}
    </div>
  )
}
