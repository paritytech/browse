import { useRef } from 'preact/hooks'
import './styles.css'

interface SearchBarProps {
  value: string
  onInput: (value: string) => void
  placeholder?: string
}

export function SearchBar({ value, onInput, placeholder = 'Search' }: SearchBarProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasValue = value.length > 0

  function handleFocus() {
    wrapRef.current?.classList.add('search-bar--focus')
  }

  function handleBlur() {
    wrapRef.current?.classList.remove('search-bar--focus')
  }

  return (
    <div ref={wrapRef} class={`search-bar${hasValue ? ' search-bar--has-value' : ''}`}>
      <svg class='search-bar__icon' width='16' height='16' viewBox='0 0 16 16' fill='none'>
        <circle cx='7' cy='7' r='5.5' stroke='currentColor' stroke-width='1.3' />
        <path d='M11 11l3.5 3.5' stroke='currentColor' stroke-width='1.3' stroke-linecap='round' />
      </svg>
      <span class='search-bar__placeholder'>{placeholder}</span>
      <input
        ref={inputRef}
        class='search-bar__input'
        type='text'
        autocomplete='off'
        spellcheck={false}
        value={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </div>
  )
}
