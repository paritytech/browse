import { Button } from './Button'
import type { Operator } from '../lib/calculator'

type Props = {
  clearLabel: string
  activeOp: Operator | null
  onNumber: (n: string) => void
  onOperator: (op: Operator | '=') => void
  onClear: () => void
  onSign: () => void
  onPercent: () => void
}

export function Buttons({
  clearLabel,
  activeOp,
  onNumber,
  onOperator,
  onClear,
  onSign,
  onPercent
}: Props) {
  return (
    <div class='buttons'>
      <Button kind='func' onClick={onClear}>
        {clearLabel}
      </Button>
      <Button kind='func' onClick={onSign}>
        +/−
      </Button>
      <Button kind='func' onClick={onPercent}>
        %
      </Button>
      <Button kind='op' active={activeOp === '/'} onClick={() => onOperator('/')}>
        ÷
      </Button>

      <Button kind='num' onClick={() => onNumber('7')}>
        7
      </Button>
      <Button kind='num' onClick={() => onNumber('8')}>
        8
      </Button>
      <Button kind='num' onClick={() => onNumber('9')}>
        9
      </Button>
      <Button kind='op' active={activeOp === '*'} onClick={() => onOperator('*')}>
        ×
      </Button>

      <Button kind='num' onClick={() => onNumber('4')}>
        4
      </Button>
      <Button kind='num' onClick={() => onNumber('5')}>
        5
      </Button>
      <Button kind='num' onClick={() => onNumber('6')}>
        6
      </Button>
      <Button kind='op' active={activeOp === '-'} onClick={() => onOperator('-')}>
        −
      </Button>

      <Button kind='num' onClick={() => onNumber('1')}>
        1
      </Button>
      <Button kind='num' onClick={() => onNumber('2')}>
        2
      </Button>
      <Button kind='num' onClick={() => onNumber('3')}>
        3
      </Button>
      <Button kind='op' active={activeOp === '+'} onClick={() => onOperator('+')}>
        +
      </Button>

      <Button kind='num' extraClass='btn-zero' onClick={() => onNumber('0')}>
        0
      </Button>
      <Button kind='num' onClick={() => onNumber('.')}>
        .
      </Button>
      <Button kind='equals' onClick={() => onOperator('=')}>
        =
      </Button>
    </div>
  )
}
