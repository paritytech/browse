import { useEffect } from 'preact/hooks'
import './styles.css'

interface ToastProps {
  message: string | null
  isError?: boolean
  action?: { label: string; onClick: () => void } | null
  onDismiss: () => void
}

export function Toast({ message, isError, action, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDismiss, isError ? 5000 : 3000)
    return () => clearTimeout(timer)
  }, [message, isError, onDismiss])

  return (
    <div class={`toast${message ? ' toast--visible' : ''}${action ? ' toast--interactive' : ''}`}>
      <span>{message}</span>
      {action && (
        <button class='toast__action' onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
