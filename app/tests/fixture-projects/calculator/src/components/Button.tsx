import type { ComponentChildren } from 'preact'

type Kind = 'num' | 'op' | 'equals' | 'func'

type Props = {
  kind: Kind
  active?: boolean
  extraClass?: string
  onClick: () => void
  children: ComponentChildren
}

const KIND_CLASS: Record<Kind, string> = {
  num: 'btn-number',
  op: 'btn-op',
  equals: 'btn-op btn-equals',
  func: 'btn-func'
}

export function Button({ kind, active, extraClass, onClick, children }: Props) {
  const cls = [KIND_CLASS[kind], active && 'active', extraClass].filter(Boolean).join(' ')
  return (
    <button class={cls} onClick={onClick}>
      {children}
    </button>
  )
}
