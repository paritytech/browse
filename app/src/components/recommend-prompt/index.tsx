import { useEffect } from 'preact/hooks'

import './styles.css'

interface RecommendPromptProps {
  visible: boolean
  label: string
  onConfirm: () => void
  onDismiss: () => void
}

/**
 * Non-blocking bottom prompt asking whether the user would recommend a shared
 * app. It floats above the content without a scrim, so browse stays usable
 * while it sits there until answered.
 */
export function RecommendPrompt({ visible, label, onConfirm, onDismiss }: RecommendPromptProps) {
  useEffect(() => {
    if (!visible) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, onDismiss])

  return (
    <div
      class={`recommend-prompt${visible ? ' recommend-prompt--visible' : ''}`}
      role='dialog'
      aria-label='Recommend this app'
    >
      <div class='recommend-prompt__body'>
        <p class='recommend-prompt__text'>
          Hi! Would you recommend <strong>{label}.dot</strong> to your friends?
        </p>
        <div class='recommend-prompt__actions'>
          <button
            type='button'
            class='recommend-prompt__btn recommend-prompt__btn--primary'
            onClick={onConfirm}
          >
            Yes
          </button>
          <button
            type='button'
            class='recommend-prompt__btn recommend-prompt__btn--ghost'
            onClick={onDismiss}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
