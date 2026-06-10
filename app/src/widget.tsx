import { render } from 'preact'

import { useEffect, useMemo, useState } from 'preact/hooks'

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/martian-mono'

import { CardExplore } from './components/card-explore'
import { SEARCH_ICON } from './components/icons'
import { SearchBar } from './components/search-bar'
import { WidgetCard } from './components/widget-card'
import { SELF_LABEL } from './lib/config'
import { navigateToDomain } from './lib/navigate'
import { applyInitialTheme, subscribeHostTheme } from './lib/theme'
import { prefetchAllApps, useGetAllApps } from './state/apps/queries'
import { filterApps } from './state/apps/types'
import './styles/tokens.css'
import './styles/main.css'
import './styles/widget.css'

// The four dashboard presets the host can mount this widget at. The host doesn't
// tell the widget which one it picked, so we infer it from our own viewport: only
// the `horizontal` preset is two columns wide, and the single-column presets are
// told apart by height (2 / 4 / 8 grid rows).
type WidgetSize = 'small' | 'medium' | 'large' | 'horizontal'

// Product tiles shown per preset. One slot is always reserved on top of these for
// the "Browse More" tile (the 2nd / 4th / 10th / 8th position respectively).
const APP_CAP: Record<WidgetSize, number> = {
  small: 1,
  medium: 3,
  large: 9,
  horizontal: 7
}

// Columns per preset. Rows are derived from the actual tile count (see below) so
// the grid only ever has as many rows as it needs, with no trailing empty rows.
const GRID_COLS: Record<WidgetSize, number> = {
  small: 2,
  medium: 2,
  large: 2,
  horizontal: 4
}

function classifyWidgetSize(width: number, height: number): WidgetSize {
  if (width >= 500) return 'horizontal'
  if (height < 320) return 'small'
  if (height < 630) return 'medium'
  return 'large'
}

function useWidgetSize(): WidgetSize {
  const [size, setSize] = useState(() => classifyWidgetSize(window.innerWidth, window.innerHeight))

  useEffect(() => {
    const update = () => setSize(classifyWidgetSize(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return size
}

function Widget() {
  const queryClient = useQueryClient()
  const size = useWidgetSize()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  const { data: allApps = [], isFetching } = useGetAllApps(queryClient)

  useEffect(() => subscribeHostTheme(), [])

  // Focus the field as soon as the search bar replaces the header.
  useEffect(() => {
    if (!searchOpen) return
    document.querySelector<HTMLInputElement>('.widget__header .search-bar__input')?.focus()
  }, [searchOpen])

  const results = useMemo(
    () => filterApps(allApps, query, 'all').filter((app) => app.label !== SELF_LABEL),
    [allApps, query]
  )
  // Count of the unfiltered set, used to size the grid.
  const baseCount = useMemo(
    () => filterApps(allApps, '', 'all').filter((app) => app.label !== SELF_LABEL).length,
    [allApps]
  )

  const isSearching = query.trim().length > 0
  const cap = APP_CAP[size]
  const visible = results.slice(0, cap)
  const showBrowseMore = !isSearching
  // Row count comes from the default (unfiltered) layout so the grid keeps the
  // same shape while the user filters (matches just leave empty cells, no resize),
  // and it counts the real apps rather than the cap so there are no empty rows.
  // Rows are capped (minmax below) so a tall preset with few apps doesn't stretch
  // the cards — leftover height stays at the bottom.
  const baseTiles = Math.min(baseCount, cap) + 1
  const rows = Math.max(1, Math.ceil(baseTiles / GRID_COLS[size]))
  const gridStyle = `grid-template-rows: repeat(${rows}, minmax(0, 180px))`
  const openSpa = () => navigateToDomain(SELF_LABEL)
  const closeSearch = () => {
    setQuery('')
    setSearchOpen(false)
  }

  // Nothing to show until the first fetch settles. This avoids a lone "Browse
  // More" tile flashing before the products arrive.
  if (isFetching && results.length === 0 && !query) {
    return <div class='widget' />
  }

  return (
    <div class={`widget widget--${size}`}>
      {/* The smallest preset has no room for chrome: drop the header (title and
          search) entirely and give the whole frame to the tiles. */}
      {size !== 'small' ? (
        <div class='widget__header' onKeyDown={(e) => e.key === 'Escape' && closeSearch()}>
          {searchOpen ? (
            <SearchBar value={query} onInput={setQuery} onCancel={closeSearch} />
          ) : (
            <>
              <span class='widget__title'>Popular Apps</span>
              <button
                class='widget__search'
                type='button'
                aria-label='Search products'
                onClick={() => setSearchOpen(true)}
              >
                {SEARCH_ICON}
              </button>
            </>
          )}
        </div>
      ) : null}
      <div class={`widget__grid widget__grid--${size}`} style={gridStyle}>
        {visible.map((app, i) => (
          <WidgetCard key={app.label} app={app} index={i} onClick={navigateToDomain} />
        ))}
        {showBrowseMore ? <CardExplore index={visible.length} onClick={openSpa} /> : null}
      </div>
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
