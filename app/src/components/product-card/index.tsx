import { memo, useEffect, useState } from 'preact/compat'

import { ArrowBigUp, ArrowUpRight, Bookmark, Share2 } from 'lucide-preact'

import { BubbleBurst } from './bubble-burst'
import { useIconBlob } from '../../state/apps/icon'
import { type AppCertificate, type AppEntry, displayName } from '../../state/apps/types'
import { CertificateBadge } from '../certificate-badge'
import { Identicon } from '../identicon'
import './styles.css'

interface ProductCardProps {
  app: AppEntry
  index: number
  bookmarked?: boolean
  recommended?: boolean
  attestationPending?: boolean
  provisioning?: boolean
  recommending?: boolean
  showMenu?: boolean
  onClick: (label: string) => void
  onBookmark?: (label: string) => void
  onShare?: (app: AppEntry) => void
  onClickAttestation?: () => void
  onClickCertificate?: (certificate: AppCertificate) => void
}

export const ProductCard = memo(function ProductCard({
  app,
  index,
  bookmarked,
  recommended,
  attestationPending,
  provisioning = false,
  recommending = false,
  showMenu = true,
  onClick,
  onBookmark,
  onShare,
  onClickAttestation,
  onClickCertificate
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

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const bursting = recommending && !reduceMotion

  // Keep the gooey layer mounted after the burst ends so it can recede slowly.
  // The confirmation toast lands as `bursting` flips off. `gooVisible` is
  // DERIVED (not set in an effect) so it turns on in the SAME render as
  // `bursting`/`--active`. A one-render lag would let --active start its 150ms
  // background fade before --bursting's instant fill applied, leaving the button
  // briefly translucent and flashing the goo through it.
  const [lingering, setLingering] = useState(false)
  useEffect(() => {
    if (bursting) {
      setLingering(true)
      return
    }
    if (!lingering) return
    const id = setTimeout(() => setLingering(false), 2800)
    return () => clearTimeout(id)
  }, [bursting, lingering])
  const gooVisible = bursting || lingering
  const gooFading = !bursting && lingering

  return (
    <div
      class={`product-card${instant ? ' product-card--instant' : ''}`}
      style={`animation-delay: ${delay}ms`}
      data-label={app.label}
      title={`Open ${app.label}.dot`}
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
        <div class='product-card__text'>
          <div class='product-card__title-row'>
            <span class='product-card__name'>{name}</span>
            {app.certificates.map((certificate) => (
              <button
                key={certificate.resolver}
                class='product-card__certified'
                aria-label={certificate.name ?? 'Certificate'}
                onClick={(e) => {
                  e.stopPropagation()
                  onClickCertificate?.(certificate)
                }}
              >
                <CertificateBadge cid={certificate.badgeIconCid} size={14} />
              </button>
            ))}
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
        </div>
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
                <span class='product-card__upvote-wrap'>
                  {/* The goo lives OUTSIDE the button: upvote-pop's transform makes
                      the button a stacking context, which would pull a z-index'd
                      child in front of its own fill. As a sibling it stays behind. */}
                  {gooVisible && <BubbleBurst fading={gooFading} />}
                  <button
                    class={`product-card__upvote${recommended ? ' product-card__upvote--active' : ''}${attestationPending ? ' product-card__upvote--pending' : ''}${provisioning ? ' product-card__upvote--provisioning' : ''}${gooVisible ? ' product-card__upvote--bursting' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onClickAttestation()
                    }}
                    disabled={attestationPending}
                    aria-label={recommended ? 'Remove recommendation' : 'Recommend'}
                    aria-pressed={recommended}
                    aria-busy={attestationPending}
                  >
                    <span class='product-card__upvote-label'>
                      <ArrowBigUp class='product-card__upvote-icon' size={16} />
                      {displayCount > 0 && (
                        <span class='product-card__upvote-count'>
                          {displayCount > 999 ? '999+' : displayCount}
                        </span>
                      )}
                    </span>
                  </button>
                </span>
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
