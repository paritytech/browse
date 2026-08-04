export type Operator = '+' | '-' | '*' | '/'

export const OP_SYMBOLS: Record<Operator, string> = {
  '/': '÷',
  '*': '×',
  '-': '−',
  '+': '+'
}

export const formatNumber = (n: number | string): string => {
  if (typeof n === 'string') return n
  if (!Number.isFinite(n)) return 'Error'
  return parseFloat(n.toPrecision(12)).toString()
}

export const compute = (a: string, op: Operator, b: string): number => {
  const x = parseFloat(a)
  const y = parseFloat(b)
  switch (op) {
    case '+':
      return x + y
    case '-':
      return x - y
    case '*':
      return x * y
    case '/':
      return y === 0 ? Infinity : x / y
  }
}
