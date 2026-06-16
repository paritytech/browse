import { useEffect, useRef } from 'preact/hooks'
import './styles.css'

interface ToastProps {
  message: string | null
  isError?: boolean
  action?: { label: string; onClick: () => void } | null
  onDismiss: () => void
}

export function Toast({ message, isError, action, onDismiss }: ToastProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDismiss, isError ? 5000 : 3000)
    return () => clearTimeout(timer)
  }, [message, isError, onDismiss])

  // Pin the toast above the host bottom tab bar.
  useEffect(() => {
    const vv = window.visualViewport
    const el = ref.current
    if (!vv || !el) return
    const GAP = 20 // px above the tab bar
    const place = () => {
      const usableH = document.documentElement.clientHeight
      el.style.bottom = 'auto'
      el.style.top = `${Math.round(vv.offsetTop + usableH - el.offsetHeight - GAP)}px`
    }
    place()
    vv.addEventListener('scroll', place)
    vv.addEventListener('resize', place)
    return () => {
      vv.removeEventListener('scroll', place)
      vv.removeEventListener('resize', place)
    }
  }, [message])

  return (
    <div
      ref={ref}
      class={`toast${message ? ' toast--visible' : ''}${action ? ' toast--interactive' : ''}${isError ? ' toast--error' : ''}`}
    >
      <span>{message}</span>
      {action && (
        <button class='toast__action' onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
