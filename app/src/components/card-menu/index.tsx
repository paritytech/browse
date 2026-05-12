import { useEffect, useRef, useState } from 'preact/hooks'

import { Bookmark, MessageSquare, MoreHorizontal, Share2 } from 'lucide-preact'

import './styles.css'

interface CardMenuProps {
  bookmarked: boolean
  hasChat?: boolean
  onBookmark: () => void
  onShare: () => void
}

export function CardMenu({ bookmarked, hasChat, onBookmark, onShare }: CardMenuProps) {
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
          <button class='card-menu__item' onClick={pick(onShare)} role='menuitem'>
            <Share2 size={16} />
            <span>Share</span>
          </button>
          {hasChat && (
            <button class='card-menu__item' role='menuitem' disabled aria-disabled='true'>
              <MessageSquare size={16} />
              <span>Open chat</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
