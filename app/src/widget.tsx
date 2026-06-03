import { render } from 'preact'

import { useDeferredValue } from 'preact/compat'
import { useEffect, useMemo, useState } from 'preact/hooks'

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/martian-mono'

import { SearchBar } from './components/search-bar'
import { WidgetCard } from './components/widget-card'
import { navigateToDomain } from './lib/navigate'
import { applyInitialTheme, subscribeHostTheme } from './lib/theme'
import { prefetchAllApps, useGetAllApps, useResolveLabel } from './state/apps/queries'
import { type AppEntry, filterApps } from './state/apps/types'
import './styles/tokens.css'
import './styles/main.css'
import './styles/widget.css'

function Widget() {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const { data: allApps = [], isFetching } = useGetAllApps(queryClient)

  // Same source and ordering as the SPA's All tab.
  const filtered = useMemo(
    () => filterApps(allApps, deferredQuery, 'all'),
    [allApps, deferredQuery]
  )

  const tryLabel = query
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
  const resolverLabel = debouncedQuery
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
  const shouldResolve = debouncedQuery === query && resolverLabel.length >= 3

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 500)
    return () => clearTimeout(id)
  }, [query])

  const { data: resolvedApp, isFetching: resolverFetching } = useResolveLabel(
    resolverLabel,
    shouldResolve
  )

  // True while typing hasn't settled or the on-chain resolver is fetching.
  const isSearching =
    query.length > 0 &&
    (deferredQuery !== query ||
      debouncedQuery !== query ||
      (resolverLabel.length >= 3 && resolverFetching))

  useEffect(() => subscribeHostTheme(), [])

  const results: AppEntry[] = useMemo(() => {
    if (!query) return filtered
    const merged = [...filtered]
    if (resolvedApp && !merged.some((app) => app.label === resolvedApp.label)) {
      merged.push(resolvedApp)
    }
    return merged
  }, [query, filtered, resolvedApp])

  return (
    <div class='widget'>
      <div class='widget__search'>
        <SearchBar value={query} onInput={setQuery} onCancel={() => setQuery('')} />
      </div>

      {results.length > 0 ? (
        <div class='widget__grid'>
          {results.map((app, i) => (
            <WidgetCard key={app.label} app={app} index={i} onClick={navigateToDomain} />
          ))}
        </div>
      ) : isFetching && !query ? null : query ? (
        isSearching ? (
          <div class='widget__empty'>
            <p class='widget__empty-text'>Searching for "{query}"…</p>
            <div class='loading-dots loading-dots--inline'>
              <span class='loading-dots__dot' />
              <span class='loading-dots__dot' />
              <span class='loading-dots__dot' />
            </div>
          </div>
        ) : (
          <div class='widget__empty'>
            <p class='widget__empty-text'>No products matching "{query}"</p>
            <button class='widget__empty-btn' onClick={() => navigateToDomain(tryLabel)}>
              Try {tryLabel}.dot anyway
            </button>
          </div>
        )
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
