import { render } from 'preact'

import { useEffect, useMemo, useState } from 'preact/hooks'

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/martian-mono'

import { SearchBar } from './components/search-bar'
import { WidgetCard } from './components/widget-card'
import { navigateToDomain } from './lib/navigate'
import { applyInitialTheme, subscribeHostTheme } from './lib/theme'
import { prefetchAllApps, useGetAllApps } from './state/apps/queries'
import { filterApps } from './state/apps/types'
import './styles/tokens.css'
import './styles/main.css'
import './styles/widget.css'

function Widget() {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')

  const { data: allApps = [], isFetching } = useGetAllApps(queryClient)

  // Same source and ordering as the SPA's All tab.
  const filtered = useMemo(() => filterApps(allApps, query, 'all'), [allApps, query])

  const tryLabel = query
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')

  useEffect(() => subscribeHostTheme(), [])

  return (
    <div class='widget'>
      <div class='widget__search'>
        <SearchBar value={query} onInput={setQuery} onCancel={() => setQuery('')} />
      </div>

      {filtered.length > 0 ? (
        <div class='widget__grid'>
          {filtered.map((app, i) => (
            <WidgetCard key={app.label} app={app} index={i} onClick={navigateToDomain} />
          ))}
        </div>
      ) : isFetching && !query ? null : query ? (
        <div class='widget__empty'>
          <p class='widget__empty-text'>No products matching "{query}"</p>
          <button class='widget__empty-btn' onClick={() => navigateToDomain(tryLabel)}>
            Try {tryLabel}.dot anyway
          </button>
        </div>
      ) : (
        <div class='widget__empty'>
          <p class='widget__empty-text'>No products published yet</p>
        </div>
      )}
    </div>
  )
}

const queryClient = new QueryClient()

applyInitialTheme()
prefetchAllApps(queryClient)

render(
  <QueryClientProvider client={queryClient}>
    <Widget />
  </QueryClientProvider>,
  document.getElementById('app')!
)
