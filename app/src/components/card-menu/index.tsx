import { useEffect, useRef, useState } from 'preact/hooks'

import { ArrowBigUp, Bookmark, MoreHorizontal, Share2 } from 'lucide-preact'

import './styles.css'

interface CardMenuProps {
  bookmarked: boolean
  recommended?: boolean
  onBookmark: () => void
  onShare: () => void
  onRecommend?: () => void
}

export function CardMenu({
  bookmarked,
  recommended,
  onBookmark,
  onShare,
  onRecommend
}: CardMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(handler: () => void) {
    return (e: Event) => {
      e.stopPropagation()
      setOpen(false)
      handler()
    }
  }

  return (
    <div class='card-menu' ref={rootRef}>
      <button
        class='card-menu__trigger'
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
        }}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-label='More options'
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div class='card-menu__popover' role='menu'>
          <button class='card-menu__item' onClick={pick(onBookmark)} role='menuitem'>
            <Bookmark size={16} fill={bookmarked ? 'currentColor' : 'none'} />
            <span>{bookmarked ? 'Remove bookmark' : 'Bookmark'}</span>
          </button>
          {onRecommend && (
            <button class='card-menu__item' onClick={pick(onRecommend)} role='menuitem'>
              <ArrowBigUp size={16} fill={recommended ? 'currentColor' : 'none'} />
              <span>{recommended ? 'Remove recommendation' : 'Recommend'}</span>
            </button>
          )}
          <button class='card-menu__item' onClick={pick(onShare)} role='menuitem'>
            <Share2 size={16} />
            <span>Share</span>
          </button>
        </div>
      )}
    </div>
  )
}
