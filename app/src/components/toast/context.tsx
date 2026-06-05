import { createContext } from 'preact'

import { useContext } from 'preact/hooks'

interface ToastContextValue {
  showToast: (message: string, isError?: boolean) => void
}

export const ToastContext = createContext<ToastContextValue>({
  showToast: () => {}
})

export function useToast() {
  return useContext(ToastContext)
}
