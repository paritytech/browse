import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { hostApi } from '@novasamatech/product-sdk'

import { CategoryTabs } from './components/category-tabs'
import { ProductCard } from './components/product-card'
import { SearchBar } from './components/search-bar'
import { type AppEntry, filterApps, type FilterMode, getAllApps, getPcfApps } from './data'
import { getCachedAll, getCachedPcf, setCachedAll, setCachedPcf } from './lib/cache'
import { setupDebugConsole } from './lib/debug'

export function App() {
  const [pcfApps, setPcfApps] = useState<AppEntry[]>([])
  const [allApps, setAllApps] = useState<AppEntry[]>([])
  const [pcfLoaded, setPcfLoaded] = useState(false)
  const [allLoaded, setAllLoaded] = useState(false)
  const [currentMode, setCurrentMode] = useState<FilterMode>('pcf')
  const [query, setQuery] = useState('')

  const rootRef = useRef<HTMLDivElement>(null)
  const allSyncStartedRef = useRef(false)

  const allAppsRef = useRef(allApps)
  allAppsRef.current = allApps

  function navigateToDomain(label: string) {
    if (hostApi?.navigateTo) {
      hostApi.navigateTo({ tag: 'v1', value: `${label}.dot` })
    } else {
      window.open(`https://${label}.dot.li`, '_blank', 'noopener')
    }
  }

  useEffect(() => {
    function onHashChange() {
      const segment = location.hash.slice(1).toLowerCase()
      if (segment === 'all' || segment === 'pcf') {
        setCurrentMode(segment as FilterMode)
      }
    }
    onHashChange()
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    setupDebugConsole()
  }, [])

  const syncAll = useCallback(() => {
    if (allSyncStartedRef.current) return
    allSyncStartedRef.current = true

    getAllApps((progressApps) => {
      if (progressApps.length > allAppsRef.current.length) {
        setAllApps(progressApps)
        setCachedAll(progressApps)
      }
    }).then((result) => {
      if (result.status === 'ok' || result.status === 'mock') {
        setAllApps(result.apps)
        setCachedAll(result.apps)
      }
      setAllLoaded(true)
    })
  }, [])

  useEffect(() => {
    async function loadData() {
      const [cachedPcf, cachedAll] = await Promise.all([getCachedPcf(), getCachedAll()])

      if (cachedPcf.length > 0) {
        setPcfApps(cachedPcf)
        setPcfLoaded(true)
      }
      if (cachedAll.length > 0) {
        setAllApps(cachedAll)
        setAllLoaded(true)
      }

      getPcfApps().then((result) => {
        if (result.status === 'ok' || result.status === 'mock') {
          setPcfApps(result.apps)
          setCachedPcf(result.apps)
        }
        setPcfLoaded(true)
      })

      syncAll()
    }

    loadData()
  }, [syncAll])

  useEffect(() => {
    if (currentMode === 'all') syncAll()
  }, [currentMode, syncAll])

  const allAppsCombined = [...pcfApps, ...allApps]
  const filtered = filterApps(allAppsCombined, query, currentMode)
  const modeTotal = filterApps(allAppsCombined, '', currentMode).length
  const isLoading = currentMode === 'pcf' ? !pcfLoaded : !allLoaded

  const countText =
    modeTotal > 0
      ? query
        ? `${filtered.length} of ${modeTotal} products`
        : `${modeTotal} products`
      : ''

  return (
    <div class='page' ref={rootRef}>
      <div class='main'>
        <div class='header'>
          <h1 class='title'>
            <span class='title__white'>browse.</span>
            <span class='title__muted'>dot</span>
          </h1>
          <p class='subtitle'>products on polkadot</p>
        </div>

        <div class='card-flip' id='card-flip'>
          <div class='card front' id='card-front'>
            <SearchBar value={query} onInput={setQuery} />
            <CategoryTabs active={currentMode} onSwitch={setCurrentMode} />

            <div class='app-list' id='app-list'>
              {isLoading && filtered.length === 0 ? null : filtered.length === 0 && query ? (
                <div class='empty-state'>
                  <div class='empty-state__icon'>
                    <svg width='32' height='32' viewBox='0 0 32 32' fill='none'>
                      <circle cx='14' cy='14' r='10' stroke='currentColor' stroke-width='2' />
                      <path
                        d='M22 22l6 6'
                        stroke='currentColor'
                        stroke-width='2'
                        stroke-linecap='round'
                      />
                    </svg>
                  </div>
                  <p class='empty-state__text'>No products matching "{query}"</p>
                  <p class='empty-state__hint'>Try a different search term</p>
                </div>
              ) : (
                filtered.map((app, i) => (
                  <ProductCard key={app.label} app={app} index={i} onClick={navigateToDomain} />
                ))
              )}
            </div>

            <div
              class='loading-dots'
              id='loading-dots'
              style={{ display: isLoading ? 'flex' : 'none' }}
            >
              <span class='loading-dots__dot' />
              <span class='loading-dots__dot' />
              <span class='loading-dots__dot' />
            </div>

            <div class='list-count' id='list-count'>
              {countText}
            </div>
          </div>

          <div class='card back' id='card-back'>
            <div class='debug-header'>
              <span class='debug-title'>debug</span>
              <span class='debug-count' id='debug-count' />
            </div>
            <div class='debug-log' id='debug-log' />
          </div>
        </div>

        <div class='footer' />
      </div>
    </div>
  )
}
