import { memo, useState } from 'preact/compat'

import { ArrowUp, Bookmark, MessageCircle, Share2 } from 'lucide-preact'

import { iconUrl } from '../../state/apps/manifest'
import { type AppEntry, displayName } from '../../state/apps/types'
import { Identicon } from '../identicon'
import './styles.css'

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
  onChat?: (label: string) => void
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
  onClickAttestation,
  onChat
}: ProductCardProps) {
  const instant = index < 0
  const delay = instant ? 0 : Math.min(index * 60, 400)
  const name = displayName(app)
  const displayCount = app.attestationCount ?? 0
  const [iconFailed, setIconFailed] = useState(false)
  const showIcon = app.iconCid && !iconFailed
  const showActions = showMenu && onBookmark && onShare

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
        {showIcon ? (
          <img
            class='product-card__thumb-img'
            src={iconUrl(app.iconCid as string)}
            alt=''
            onError={() => setIconFailed(true)}
          />
        ) : (
          <Identicon seed={app.label} size={42} />
        )}
      </div>
      <div class='product-card__body'>
        <div class='product-card__title-row'>
          <span class='product-card__name'>{name}</span>
          {showActions && (
            <button
              class={`product-card__bookmark${bookmarked ? ' product-card__bookmark--active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onBookmark(app.label)
              }}
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
              aria-pressed={bookmarked}
            >
              <Bookmark size={16} fill={bookmarked ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>
        <p class='product-card__desc'>{app.description}</p>
        <div class='product-card__footer'>
          <button
            class='product-card__open'
            onClick={(e) => {
              e.stopPropagation()
              onClick(app.label)
            }}
          >
            <span>Open</span>
          </button>
          {app.hasChat && (
            <button
              class='product-card__chat'
              onClick={(e) => {
                e.stopPropagation()
                onChat?.(app.label)
              }}
              disabled={!onChat}
              aria-disabled={!onChat}
              aria-label='Open chat'
            >
              <MessageCircle size={16} />
            </button>
          )}
          {showActions && (
            <div class='product-card__footer-end'>
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
                  <ArrowUp size={16} />
                  {displayCount > 0 && (
                    <span class='product-card__upvote-count'>
                      {displayCount > 999 ? '999+' : displayCount}
                    </span>
                  )}
                </button>
              )}
              <button
                class='product-card__share'
                onClick={(e) => {
                  e.stopPropagation()
                  onShare(app)
                }}
                aria-label='Share'
              >
                <Share2 size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
