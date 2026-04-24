import { useDeferredValue } from 'preact/compat'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { createAccountsProvider, hostApi } from '@novasamatech/product-sdk'
import { useQueryClient } from '@tanstack/react-query'

import { CategoryTabs } from './components/category-tabs'
import { ContactsManager } from './components/contacts-manager'
import { FOLLOW_ICON, SEARCH_ICON, STAR_ICON } from './components/icons'
import { ProductCardWithAttestation } from './components/product-card/product-card-with-attestation'
import { SearchBar } from './components/search-bar'
import { Toast } from './components/toast'
import { ToastContext } from './components/toast/context'
import { setupDebugConsole } from './lib/debug'
import { useEvent } from './lib/use-event'
import { useGetAllApps, useGetPcfApps, useResolveLabel } from './state/apps/queries'
import { filterApps, type FilterMode } from './state/apps/types'
import { useGetAttestationsByContacts } from './state/attestations/queries'
import { addBookmark, getBookmarks, removeBookmark } from './state/bookmarks/api'
import { addContact, type ContactEntry, getContacts, removeContact } from './state/contacts/api'

const TAB_MODES: FilterMode[] = ['pcf', 'bookmarks', 'following', 'all']

function navigateToDomain(label: string) {
  if (hostApi?.navigateTo) {
    hostApi.navigateTo({ tag: 'v1', value: `${label}.dot` })
  } else {
    window.open(`https://${label}.dot.li`, '_blank', 'noopener')
  }
}

export function App() {
  const queryClient = useQueryClient()

  const [currentMode, setCurrentMode] = useState<FilterMode>('pcf')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => new Set())
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastIsError, setToastIsError] = useState(false)
  const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | null>(
    null
  )
  const [signed, setSigned] = useState(false)
  const [contacts, setContacts] = useState<ContactEntry[]>([])
  const [showContactsManager, setShowContactsManager] = useState(false)
  const [showTopCount, setShowTopCount] = useState(false)
  const deferredQuery = useDeferredValue(query)

  const rootRef = useRef<HTMLDivElement>(null)
  const bottomCountRef = useRef<HTMLDivElement>(null)

  const { data: pcfApps = [], isFetching: pcfFetching } = useGetPcfApps()
  const { data: allApps = [], isFetching: allFetching } = useGetAllApps(queryClient)

  const allAppsCombined = useMemo(() => {
    const seen = new Set<string>()
    return [...pcfApps, ...allApps].filter((app) => {
      if (seen.has(app.label)) return false
      seen.add(app.label)
      return true
    })
  }, [pcfApps, allApps])
  const contactAddresses = useMemo(() => contacts.map((c) => c.address), [contacts])

  const { data: followedLabels = new Set<string>(), isLoading: followingLoading } =
    useGetAttestationsByContacts(allAppsCombined, contactAddresses)

  const filtered = useMemo(
    () => filterApps(allAppsCombined, deferredQuery, currentMode, bookmarks, followedLabels),
    [allAppsCombined, deferredQuery, currentMode, bookmarks, followedLabels]
  )
  const modeTotal = useMemo(
    () => filterApps(allAppsCombined, '', currentMode, bookmarks, followedLabels).length,
    [allAppsCombined, currentMode, bookmarks, followedLabels]
  )
  const filteredAcrossTabs = useMemo(
    () =>
      filterApps(allAppsCombined, query, 'all', bookmarks, followedLabels).concat(
        filterApps(allAppsCombined, query, 'pcf', bookmarks, followedLabels)
      ),
    [allAppsCombined, query, bookmarks, followedLabels]
  )
  const otherTabHits = useMemo(() => {
    if (filtered.length > 0 || !deferredQuery) return []
    return TAB_MODES.filter((m) => m !== currentMode)
      .map((m) => ({
        mode: m,
        count: filterApps(allAppsCombined, deferredQuery, m, bookmarks, followedLabels).length
      }))
      .filter((h) => h.count > 0)
  }, [filtered.length, deferredQuery, currentMode, allAppsCombined, bookmarks, followedLabels])

  const resolverLabel = debouncedQuery
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
  const shouldResolve =
    debouncedQuery === query && filteredAcrossTabs.length === 0 && resolverLabel.length > 0
  const { data: resolvedApp } = useResolveLabel(resolverLabel, shouldResolve)

  const handleStar = useEvent((label: string) => {
    if (bookmarks.has(label)) {
      // Animate card out, then remove from bookmarks
      const card = rootRef.current?.querySelector(`[data-label="${label}"]`) as HTMLElement | null
      const doRemove = () => {
        removeBookmark(label)
        setBookmarks((prev) => {
          const next = new Set(prev)
          next.delete(label)
          return next
        })
      }
      if (card && currentMode === 'bookmarks') {
        card.classList.add('product-card--removing')
        setTimeout(doRemove, 400)
      } else {
        doRemove()
      }
      setToastIsError(false)
      setToastAction({
        label: 'Undo',
        onClick: () => {
          addBookmark(label)
          setBookmarks((prev) => new Set(prev).add(label))
          setToastMessage(null)
          setToastAction(null)
        }
      })
      setToastMessage('Removed from bookmarks')
    } else {
      addBookmark(label)
      setBookmarks((prev) => new Set(prev).add(label))
      setToastAction(null)
    }
  })
  const showToast = useEvent((message: string, isError = false) => {
    setToastIsError(isError)
    setToastMessage(message)
  })
  const handleAddContact = useEvent((address: string, username?: string) => {
    addContact(address, username)
    setContacts((prev) => [...prev, { address, username }])
  })
  const handleRemoveContact = useEvent((address: string) => {
    removeContact(address)
    setContacts((prev) => prev.filter((c) => c.address !== address))
  })

  // Subscribe to account connection status
  useEffect(() => {
    const provider = createAccountsProvider()
    const sub = provider.subscribeAccountConnectionStatus((status) => {
      setSigned(status === 'connected')
    })
    return () => sub.unsubscribe()
  }, [])

  // Load bookmarks and contacts on mount
  useEffect(() => {
    getBookmarks().then(setBookmarks)
    getContacts().then(setContacts)
  }, [])

  useEffect(() => {
    function onHashChange() {
      const segment = location.hash.slice(1).toLowerCase()
      if (
        segment === 'pcf' ||
        segment === 'all' ||
        segment === 'bookmarks' ||
        segment === 'following'
      ) {
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

  // Show the top count label only when the bottom one is out of view
  // (i.e. the list overflows the visible area).
  useEffect(() => {
    const el = bottomCountRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => setShowTopCount(!entries[0].isIntersecting),
      { threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 500)
    return () => clearTimeout(id)
  }, [query])

  const isLoading =
    currentMode === 'pcf'
      ? pcfFetching
      : currentMode === 'bookmarks'
        ? false
        : currentMode === 'following'
          ? followingLoading
          : allFetching
  const emptyBookmarks = currentMode === 'bookmarks' && modeTotal === 0 && !query
  const emptyFollowingNoContacts = currentMode === 'following' && contacts.length === 0 && !query
  const emptyFollowingNoMatches =
    currentMode === 'following' &&
    contacts.length > 0 &&
    modeTotal === 0 &&
    !query &&
    !followingLoading
  const countText =
    modeTotal > 0
      ? query
        ? `${filtered.length} of ${modeTotal} products`
        : `${modeTotal} products`
      : ''

  return (
    <ToastContext.Provider value={{ showToast }}>
      <div class='page' ref={rootRef}>
        <div class='main'>
          <div class='header'>
            <h1 class='title'>
              <span class='title__white'>browse</span>
            </h1>
            <p class='subtitle'>
              <span>products</span>
              <span class='subtitle__dot' />
              <span>on polkadot</span>
            </p>
          </div>

          <div class='card-flip' id='card-flip'>
            <div class='card front' id='card-front'>
              <SearchBar value={query} onInput={setQuery} />
              <CategoryTabs
                active={currentMode}
                signed={signed}
                onSwitch={(mode) => {
                  setCurrentMode(mode)
                  setShowContactsManager(false)
                }}
              />

              <div class='app-list' id='app-list'>
                {showTopCount && countText && (
                  <div class='list-count list-count--top'>{countText}</div>
                )}
                {isLoading && filtered.length === 0 && !query ? null : emptyBookmarks ? (
                  <div class='empty-state'>
                    <div class='empty-state__icon'>{STAR_ICON}</div>
                    <p class='empty-state__text'>No bookmarks yet</p>
                    <p class='empty-state__hint'>Tap the star on any app to save it here</p>
                  </div>
                ) : emptyFollowingNoContacts ? (
                  <div class='empty-state'>
                    <div class='empty-state__icon' style='color: rgba(255, 255, 255, 0.3)'>
                      {FOLLOW_ICON}
                    </div>
                    <p class='empty-state__text'>Follow people to see what they recommend</p>
                    <button class='empty-state__btn' onClick={() => setShowContactsManager(true)}>
                      Add address
                    </button>
                  </div>
                ) : emptyFollowingNoMatches ? (
                  <div class='empty-state'>
                    <p class='empty-state__text'>
                      None of your contacts have recommended any apps yet
                    </p>
                    <button class='empty-state__btn' onClick={() => setShowContactsManager(true)}>
                      Manage contacts
                    </button>
                  </div>
                ) : filtered.length === 0 && resolvedApp && query ? (
                  <ProductCardWithAttestation
                    key={resolvedApp.label}
                    app={resolvedApp}
                    index={0}
                    starred={bookmarks.has(resolvedApp.label)}
                    showStar
                    onClick={navigateToDomain}
                    onStar={handleStar}
                  />
                ) : filtered.length === 0 && query ? (
                  <div class='empty-state'>
                    <div class='empty-state__icon'>{SEARCH_ICON}</div>
                    {otherTabHits.length > 0 ? (
                      <p class='empty-state__text'>
                        Found{' '}
                        {otherTabHits.map((h, i) => {
                          const last = i === otherTabHits.length - 1
                          const separator = i === 0 ? '' : last ? ' and ' : ', '
                          const tabName = h.mode.charAt(0).toUpperCase() + h.mode.slice(1)
                          const matchWord = h.count === 1 ? 'match' : 'matches'
                          return (
                            <>
                              {separator}
                              <a
                                class='empty-state__link'
                                href='#'
                                onClick={(e) => {
                                  e.preventDefault()
                                  setCurrentMode(h.mode)
                                }}
                              >
                                {h.count} {matchWord} in {tabName}
                              </a>
                            </>
                          )
                        })}
                      </p>
                    ) : (
                      <p class='empty-state__text'>No products matching "{query}"</p>
                    )}
                    <button
                      class='empty-state__btn-ghost'
                      onClick={() => navigateToDomain(query.trim().toLowerCase())}
                    >
                      Try {query.trim().toLowerCase()}.dot anyway
                    </button>
                  </div>
                ) : (
                  filtered.map((app, i) => (
                    <ProductCardWithAttestation
                      key={app.label}
                      app={app}
                      index={i}
                      starred={bookmarks.has(app.label)}
                      showStar
                      onClick={navigateToDomain}
                      onStar={handleStar}
                    />
                  ))
                )}
              </div>

              <div
                class='loading-dots'
                id='loading-dots'
                style={{ display: isLoading && !query ? 'flex' : 'none' }}
              >
                <span class='loading-dots__dot' />
                <span class='loading-dots__dot' />
                <span class='loading-dots__dot' />
              </div>

              <div class='list-count' id='list-count' ref={bottomCountRef}>
                {countText}
                {currentMode === 'following' && contacts.length > 0 && !emptyFollowingNoMatches && (
                  <button class='list-count__manage' onClick={() => setShowContactsManager(true)}>
                    Manage contacts
                  </button>
                )}
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

        <ContactsManager
          contacts={contacts}
          visible={showContactsManager}
          onAdd={handleAddContact}
          onRemove={handleRemoveContact}
          onDismiss={() => setShowContactsManager(false)}
        />

        <Toast
          message={toastMessage}
          isError={toastIsError}
          action={toastAction}
          onDismiss={() => {
            setToastMessage(null)
            setToastAction(null)
          }}
        />
      </div>
    </ToastContext.Provider>
  )
}
