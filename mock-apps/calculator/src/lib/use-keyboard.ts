import { useEffect } from 'preact/hooks'

import type { Operator } from './calculator'

type Handlers = {
  inputNumber: (n: string) => void
  applyOperator: (op: Operator | '=') => void
  clear: () => void
  percent: () => void
  backspace: () => void
}

export const useKeyboard = (handlers: Handlers): void => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { inputNumber, applyOperator, clear, percent, backspace } = handlers
      if (e.key >= '0' && e.key <= '9') inputNumber(e.key)
      else if (e.key === '.') inputNumber('.')
      else if (e.key === '+') applyOperator('+')
      else if (e.key === '-') applyOperator('-')
      else if (e.key === '*') applyOperator('*')
      else if (e.key === '/') {
        e.preventDefault()
        applyOperator('/')
      } else if (e.key === 'Enter' || e.key === '=') applyOperator('=')
      else if (e.key === 'Escape') clear()
      else if (e.key === '%') percent()
      else if (e.key === 'Backspace') backspace()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handlers])
}
