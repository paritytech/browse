import { useCallback, useState } from 'preact/hooks'

import { Buttons } from './components/Buttons'
import { Display } from './components/Display'
import { compute, formatNumber, OP_SYMBOLS, type Operator } from './lib/calculator'
import { useKeyboard } from './lib/use-keyboard'

export function App() {
  const [current, setCurrent] = useState('0')
  const [previous, setPrevious] = useState<string | null>(null)
  const [operator, setOperator] = useState<Operator | null>(null)
  const [resetNext, setResetNext] = useState(false)
  const [expression, setExpression] = useState('')

  const inputNumber = useCallback(
    (num: string) => {
      if (resetNext) {
        setCurrent(num === '.' ? '0.' : num)
        setResetNext(false)
        return
      }
      setCurrent((cur) => {
        if (num === '.') {
          if (cur.includes('.')) return cur
          return cur + '.'
        }
        if (cur === '0') return num
        if (cur.length >= 15) return cur
        return cur + num
      })
    },
    [resetNext]
  )

  const applyOperator = useCallback(
    (op: Operator | '=') => {
      if (op === '=') {
        if (operator && previous !== null) {
          const result = compute(previous, operator, current)
          setExpression(
            `${formatNumber(parseFloat(previous))} ${OP_SYMBOLS[operator]} ${formatNumber(parseFloat(current))} =`
          )
          setCurrent(formatNumber(result))
          setPrevious(null)
          setOperator(null)
          setResetNext(true)
        }
        return
      }

      let next = current
      if (operator && previous !== null && !resetNext) {
        next = formatNumber(compute(previous, operator, current))
        setCurrent(next)
      }
      setPrevious(next)
      setOperator(op)
      setResetNext(true)
      setExpression(`${formatNumber(parseFloat(next))} ${OP_SYMBOLS[op]}`)
    },
    [current, previous, operator, resetNext]
  )

  const clear = useCallback(() => {
    if (current !== '0' || resetNext) {
      setCurrent('0')
      setResetNext(false)
    } else {
      setPrevious(null)
      setOperator(null)
      setExpression('')
    }
  }, [current, resetNext])

  const toggleSign = useCallback(() => {
    setCurrent((cur) => {
      if (cur === '0' || cur === 'Error') return cur
      return cur.startsWith('-') ? cur.slice(1) : '-' + cur
    })
  }, [])

  const percent = useCallback(() => {
    setCurrent((cur) => formatNumber(parseFloat(cur) / 100))
  }, [])

  const backspace = useCallback(() => {
    setCurrent((cur) => (cur.length > 1 ? cur.slice(0, -1) : '0'))
  }, [])

  useKeyboard({ inputNumber, applyOperator, clear, percent, backspace })

  const clearLabel = current === '0' && previous === null ? 'AC' : 'C'
  const activeOp = resetNext ? operator : null

  return (
    <div class='calculator'>
      <Display expression={expression} current={current} />
      <Buttons
        clearLabel={clearLabel}
        activeOp={activeOp}
        onNumber={inputNumber}
        onOperator={applyOperator}
        onClear={clear}
        onSign={toggleSign}
        onPercent={percent}
      />
    </div>
  )
}
