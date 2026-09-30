import type { ComponentChildren, JSX } from 'preact'

import { useEffect, useRef, useState } from 'preact/hooks'

import { Plus, X } from 'lucide-preact'

import './styles.css'

export interface StackItem {
  key: string
  label: string
  avatar: ComponentChildren
  /** Disc styling for a letter avatar, such as its seeded background color. */
  avatarStyle?: JSX.CSSProperties
}

interface StackPanelProps {
  /** Modifier class that names the panel, such as `stack-panel--following`. */
  variant: string
  items: StackItem[]
  /**
   * Whether the input is expanded.
   *
   * Owned by the parent so it can hide the app list while something is being added.
   */
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemove: (key: string) => void
  input: string
  onInput: (value: string) => void
  addLabel: string
  removeLabel: (item: StackItem) => string
  moreLabel: (count: number) => string
  placeholder: string
  /** A glyph shown before the typed text, such as the `@` of a username. */
  prefix?: string
  /** The result rows under the row, built from the classes in this stylesheet. */
  children?: ComponentChildren
}

/** Avatars shown before the stack truncates into a +N circle. */
const STACK_LIMIT = 3

/**
 * A compact row under the category tabs: items as a stack of avatars with a +
 * tucked on as the next slot.
 *
 * An avatar expands to its label and a remove cross on mouse hover or on tap.
 * Past STACK_LIMIT avatars the stack truncates into a +N circle that fans every
 * label out. The + grows into a text input right of the stack, and the parent
 * renders what the input finds as `children`.
 */
export function StackPanel({
  variant,
  items,
  open,
  onOpenChange,
  onRemove,
  input,
  onInput,
  addLabel,
  removeLabel,
  moreLabel,
  placeholder,
  prefix,
  children
}: StackPanelProps) {
  // The avatar expanded by tap. Hover expansion is pure CSS on top of this.
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // Whether the whole stack is fanned out to labels, from tapping the +N circle.
  const [expandedAll, setExpandedAll] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)

  // Drop the caret into the field as it expands from the + button, folding any
  // opened avatar back into the stack, and reset the draft whenever the field
  // closes, including a close from the parent.
  useEffect(() => {
    if (open) {
      setExpandedKey(null)
      setExpandedAll(false)
      inputRef.current?.focus()
    } else {
      onInput('')
    }
  }, [open])

  // Falling back under the limit ends the fan-out.
  const overflow = items.length - STACK_LIMIT
  useEffect(() => {
    if (overflow <= 0) setExpandedAll(false)
  }, [overflow])
  const shown = expandedAll || overflow <= 0 ? items : items.slice(0, STACK_LIMIT)

  // Any click away from the fanned-out stack folds it back. A remove cross
  // stops propagation, so pruning the fan keeps it open.
  useEffect(() => {
    if (!expandedAll) return
    const onDocClick = (e: MouseEvent) => {
      if (e.target instanceof Node && stackRef.current?.contains(e.target)) return
      setExpandedAll(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [expandedAll])

  const stack = items.length > 0 && (
    <div
      ref={stackRef}
      class={`stack-panel__stack${expandedAll ? ' stack-panel__stack--expanded' : ''}`}
    >
      {shown.map((item) => (
        <div
          key={item.key}
          class={`stack-panel__chip${expandedKey === item.key ? ' stack-panel__chip--expanded' : ''}`}
          onClick={() =>
            expandedAll
              ? setExpandedAll(false)
              : setExpandedKey(expandedKey === item.key ? null : item.key)
          }
        >
          <span class='stack-panel__chip-avatar' style={item.avatarStyle}>
            {item.avatar}
          </span>
          <span class='stack-panel__chip-label'>{item.label}</span>
          <button
            type='button'
            class='stack-panel__chip-remove'
            aria-label={removeLabel(item)}
            onClick={(e) => {
              e.stopPropagation()
              onRemove(item.key)
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div class={`stack-panel ${variant}${open ? ' stack-panel--adding' : ''}`}>
      <div class='stack-panel__row'>
        {stack}
        {overflow > 0 && !expandedAll && (
          <button
            type='button'
            class='stack-panel__more'
            aria-label={moreLabel(items.length)}
            onClick={() => setExpandedAll(true)}
          >
            +{overflow}
          </button>
        )}
        {/* The + is the collapsed input: one element that grows from the last
            slot of the stack into the field, so the expansion is a single
            smooth transition instead of a swap. Hidden while the stack is
            fanned out. */}
        {!expandedAll && (
          <div class={`stack-panel__field${open ? ' stack-panel__field--open' : ''}`}>
            <button
              type='button'
              class='stack-panel__add'
              aria-label={addLabel}
              tabIndex={open ? -1 : 0}
              onClick={() => onOpenChange(true)}
            >
              <Plus size={16} />
            </button>
            {prefix && <span class='stack-panel__prefix'>{prefix}</span>}
            <input
              ref={inputRef}
              class='stack-panel__input'
              type='text'
              autocomplete='off'
              spellcheck={false}
              enterkeyhint='done'
              placeholder={placeholder}
              tabIndex={open ? 0 : -1}
              value={input}
              onInput={(e) => onInput((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // Return only puts the phone keyboard away. Results can arrive
                  // asynchronously, so choosing one always takes a tap.
                  e.preventDefault()
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  onOpenChange(false)
                }
              }}
            />
            <button
              type='button'
              class='stack-panel__close'
              aria-label='Close'
              tabIndex={open ? 0 : -1}
              onClick={() => onOpenChange(false)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {children && <div class='stack-panel__results'>{children}</div>}
    </div>
  )
}
