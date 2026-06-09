import { ArrowUpRight } from 'lucide-preact'

import { APP_STACK } from '../icons/app-stack'
import '../widget-card/styles.css'
import './styles.css'

interface CardExploreProps {
  index: number
  onClick: () => void
}

/**
 * Terminal tile in the widget grid.
 */
export function CardExplore({ index, onClick }: CardExploreProps) {
  const delay = Math.min(index * 50, 300)

  return (
    <div
      class='widget-card widget-card--explore'
      style={`animation-delay: ${delay}ms`}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div class='widget-card__thumb'>{APP_STACK}</div>
      <div class='widget-card__footer'>
        <span class='widget-card__name'>Browse More</span>
        <ArrowUpRight class='widget-card__explore-arrow' size={16} aria-hidden='true' />
      </div>
    </div>
  )
}
