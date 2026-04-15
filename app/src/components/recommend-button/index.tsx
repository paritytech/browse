import { useRef } from 'preact/hooks'

import { ThumbsUp } from 'lucide-preact'

import './styles.css'

interface RecommendButtonProps {
  recommended: boolean
  onClick: (e: Event) => void
}

export function RecommendButton({ recommended, onClick }: RecommendButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null)

  function handleClick(e: Event) {
    e.stopPropagation()
    if (btnRef.current) {
      const el = btnRef.current
      if (!recommended) {
        el.classList.add('recommend-button--pop')
        setTimeout(() => el.classList.remove('recommend-button--pop'), 300)
      } else {
        el.classList.add('recommend-button--shrink')
        setTimeout(() => el.classList.remove('recommend-button--shrink'), 300)
      }
    }
    onClick(e)
  }

  const tooltip = recommended ? 'Remove recommendation' : 'Recommend to followers'

  return (
    <button
      ref={btnRef}
      class={`recommend-button ${recommended ? 'recommend-button--active' : ''}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation()
        }
      }}
      aria-label={tooltip}
      aria-pressed={recommended}
      title={tooltip}
    >
      <ThumbsUp class='recommend-button__icon' size={18} />
    </button>
  )
}
