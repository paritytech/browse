type Props = {
  expression: string
  current: string
}

export function Display({ expression, current }: Props) {
  const isError = current === 'Error'
  const cls = ['result', current.length > 9 && 'shrink', isError && 'error']
    .filter(Boolean)
    .join(' ')
  return (
    <div class='display'>
      <div class='expression'>{expression}</div>
      <div class={cls}>{current}</div>
    </div>
  )
}
