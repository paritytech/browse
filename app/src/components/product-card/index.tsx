import { memo } from 'preact/compat'

import { ArrowBigUp, MessageSquare } from 'lucide-preact'

import { type AppEntry, displayName } from '../../state/apps/types'
import { CardMenu } from '../card-menu'
import { Identicon } from '../identicon'
import './styles.css'

const CHAT_ENABLED_LABELS = new Set(['coinflipgame03'])

interface ProductCardProps {
  app: AppEntry
  index: number
  bookmarked?: boolean
  recommended?: boolean
  showMenu?: boolean
  onClick: (label: string) => void
  onBookmark?: (label: string) => void
  onShare?: (app: AppEntry) => void
  onClickAttestation?: () => void
}

export const ProductCard = memo(function ProductCard({
  app,
  index,
  bookmarked,
  recommended,
  showMenu = true,
  onClick,
  onBookmark,
  onShare,
  onClickAttestation
}: ProductCardProps) {
  const instant = index < 0
  const delay = instant ? 0 : Math.min(index * 60, 400)
  const name = displayName(app)
  const displayCount = app.attestationCount ?? 0

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
        <Identicon seed={app.label} size={64} />
        {CHAT_ENABLED_LABELS.has(app.label) && (
          <span class='product-card__chat-badge' aria-label='Has chat'>
            <MessageSquare size={12} fill='currentColor' strokeWidth={0} />
          </span>
        )}
      </div>
      <div class='product-card__body'>
        <span class='product-card__name'>{name}</span>
        <p class='product-card__desc'>{app.description}</p>
      </div>
      {showMenu && onBookmark && onShare && (
        <div class='product-card__actions'>
          <CardMenu
            bookmarked={!!bookmarked}
            hasChat={CHAT_ENABLED_LABELS.has(app.label)}
            onBookmark={() => onBookmark(app.label)}
            onShare={() => onShare(app)}
          />
          {onClickAttestation && (
            <button
              class={`product-card__upvote${recommended ? ' product-card__upvote--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onClickAttestation()
              }}
              aria-label={recommended ? 'Remove recommendation' : 'Recommend'}
              aria-pressed={recommended}
            >
              <ArrowBigUp size={15} fill={recommended ? 'currentColor' : 'none'} />
              {displayCount >= 1 && (
                <span class='product-card__upvote-count'>
                  {displayCount > 999 ? '999+' : displayCount}
                </span>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
})
