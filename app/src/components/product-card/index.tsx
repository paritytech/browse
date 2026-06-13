import { memo, useEffect, useRef, useState } from 'preact/compat'

import { ArrowUp, ArrowUpRight, BadgeCheck, Bookmark, Share2 } from 'lucide-preact'

import { BubbleBurst } from './bubble-burst'
import { useIconBlob } from '../../state/apps/icon'
import { type AppEntry, displayName } from '../../state/apps/types'
import { Identicon } from '../identicon'
import './styles.css'

interface ProductCardProps {
  app: AppEntry
  index: number
  bookmarked?: boolean
  recommended?: boolean
  attestationPending?: boolean
  recommendBurst?: number
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
  attestationPending,
  recommendBurst = 0,
  showMenu = true,
  onClick,
  onBookmark,
  onShare,
  onClickAttestation
}: ProductCardProps) {
  const instant = index < 0
  const delay = instant ? 0 : Math.min(index * 100, 700)
  const name = displayName(app)
  const displayCount = app.attestationCount ?? 0
  const { url: iconBlobUrl, failed: iconFailed, markFailed } = useIconBlob(app.iconCid)
  const [iconLoaded, setIconLoaded] = useState(false)
  const willLoadIcon = !!app.iconCid && !iconFailed
  const haveIconBytes = willLoadIcon && !!iconBlobUrl
  const showActions = showMenu && onBookmark && onShare

  // Fire the ember burst when a recommend confirms.
  const [bursting, setBursting] = useState(false)
  const lastBurst = useRef(recommendBurst)
  useEffect(() => {
    if (recommendBurst <= lastBurst.current) return
    lastBurst.current = recommendBurst
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setBursting(true)
    const timer = setTimeout(() => setBursting(false), 1400)
    return () => clearTimeout(timer)
  }, [recommendBurst])

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
        {willLoadIcon ? (
          <>
            {!iconLoaded && <div class='product-card__thumb-pulse' />}
            {haveIconBytes && (
              <img
                class={`product-card__thumb-img${iconLoaded ? ' product-card__thumb-img--loaded' : ''}`}
                src={iconBlobUrl as string}
                alt=''
                onLoad={() => setIconLoaded(true)}
                onError={markFailed}
              />
            )}
          </>
        ) : (
          <Identicon seed={app.label} size={42} />
        )}
      </div>
      <div class='product-card__body'>
        <div class='product-card__title-row'>
          <span class='product-card__name'>{name}</span>
          {app.isCompliant && (
            <span
              class='product-card__certified'
              role='img'
              aria-label='Certificate of User Interface Compliance'
            >
              <BadgeCheck size={14} />
            </span>
          )}
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
            <ArrowUpRight size={14} />
          </button>
          {showActions && (
            <div class='product-card__footer-end'>
              {onClickAttestation && (
                <button
                  class={`product-card__upvote${recommended ? ' product-card__upvote--active' : ''}${attestationPending ? ' product-card__upvote--pending' : ''}${bursting ? ' product-card__upvote--bursting' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClickAttestation()
                  }}
                  disabled={attestationPending}
                  aria-label={recommended ? 'Remove recommendation' : 'Recommend'}
                  aria-pressed={recommended}
                  aria-busy={attestationPending}
                >
                  <ArrowUp size={16} />
                  {displayCount > 0 && (
                    <span class='product-card__upvote-count'>
                      {displayCount > 999 ? '999+' : displayCount}
                    </span>
                  )}
                  {bursting && <BubbleBurst />}
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
