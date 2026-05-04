import { render } from 'preact'

import { useMemo, useState } from 'preact/hooks'

import { SearchBar } from './components/search-bar'
import { WidgetCard } from './components/widget-card'
import { navigateToDomain } from './lib/navigate'
import './styles/main.css'
import './styles/widget.css'

const FEATURED_LABELS = [
  'host-playground',
  'truapi-playground',
  'test-dapp-01',
  'host-api-example',
  'faucet',
  'coinflipgame03'
]

function Widget() {
  const [query, setQuery] = useState('')

  const normalizedQuery = query
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')

  const filtered = useMemo(() => {
    if (!normalizedQuery) return FEATURED_LABELS
    return FEATURED_LABELS.filter((label) => label.includes(normalizedQuery))
  }, [normalizedQuery])

  return (
    <div class='widget'>
      <div class='widget__search'>
        <SearchBar value={query} onInput={setQuery} placeholder='Search or enter website name' />
      </div>

      {filtered.length > 0 ? (
        <div class='widget__grid'>
          {filtered.map((label, i) => (
            <WidgetCard key={label} label={label} index={i} onClick={navigateToDomain} />
          ))}
        </div>
      ) : (
        <div class='widget__empty'>
          <p class='widget__empty-text'>No products matching "{query}"</p>
          <button class='widget__empty-btn' onClick={() => navigateToDomain(normalizedQuery)}>
            Try {normalizedQuery}.dot anyway
          </button>
        </div>
      )}
    </div>
  )
}

render(<Widget />, document.getElementById('app')!)
