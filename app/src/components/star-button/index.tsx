import { useRef } from 'preact/hooks'

import { Star } from 'lucide-preact'

import './styles.css'

interface StarButtonProps {
  starred: boolean
  onClick: (e: Event) => void
}

export function StarButton({ starred, onClick }: StarButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null)

  function handleClick(e: Event) {
    e.stopPropagation()
    const willStar = !starred
    if (btnRef.current) {
      const el = btnRef.current
      if (willStar) {
        el.classList.add('star-button--pop')
        setTimeout(() => el.classList.remove('star-button--pop'), 300)
      } else {
        el.classList.add('star-button--shrink')
        setTimeout(() => el.classList.remove('star-button--shrink'), 300)
      }
    }
    onClick(e)
  }

  return (
    <button
      ref={btnRef}
      class={`star-button ${starred ? 'star-button--active' : ''}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation()
        }
      }}
      aria-label={starred ? 'Remove bookmark' : 'Bookmark this app'}
      aria-pressed={starred}
    >
      <Star class='star-button__icon' size={18} fill={starred ? 'currentColor' : 'none'} />
    </button>
  )
}
