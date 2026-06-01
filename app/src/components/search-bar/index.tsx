import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import './styles.css'

interface SearchBarProps {
  value: string
  onInput: (value: string) => void
  placeholder?: string
  onCancel?: () => void
}

export function SearchBar({ value, onInput, placeholder = 'Search', onCancel }: SearchBarProps) {
  const placeholderRef = useRef<HTMLSpanElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)

  // Measure the placeholder so the icon can sit just left of the centered
  // text regardless of placeholder length. Exposed as --placeholder-half-width.
  useLayoutEffect(() => {
    if (!placeholderRef.current || !rootRef.current) return
    const halfWidth = placeholderRef.current.offsetWidth / 2
    rootRef.current.style.setProperty('--placeholder-half-width', `${halfWidth}px`)
  }, [placeholder])

  const hasValue = value.length > 0
  const classes = [
    'search-bar',
    focused && 'search-bar--focus',
    hasValue && 'search-bar--has-value'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div class='search-bar-row'>
      <div class={classes} ref={rootRef}>
        <svg class='search-bar__icon' width='16' height='16' viewBox='0 0 16 16' fill='none'>
          <circle cx='7' cy='7' r='5.5' stroke='currentColor' stroke-width='1.3' />
          <path
            d='M11 11l3.5 3.5'
            stroke='currentColor'
            stroke-width='1.3'
            stroke-linecap='round'
          />
        </svg>
        <span class='search-bar__placeholder' ref={placeholderRef}>
          {placeholder}
        </span>
        <input
          class='search-bar__input'
          type='text'
          autocomplete='off'
          spellcheck={false}
          value={value}
          onInput={(e) => onInput((e.target as HTMLInputElement).value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
      {onCancel && (
        <button
          class='search-bar-row__cancel'
          onClick={onCancel}
          aria-hidden={!hasValue}
          tabIndex={hasValue ? 0 : -1}
        >
          Cancel
        </button>
      )}
    </div>
  )
}
