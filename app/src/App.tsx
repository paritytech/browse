import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { createAccountsProvider, hostApi } from '@novasamatech/product-sdk'
import { useQueryClient } from '@tanstack/react-query'

import { CategoryTabs } from './components/category-tabs'
import { ContactsManager } from './components/contacts-manager'
import { ProductCard } from './components/product-card'
import { SearchBar } from './components/search-bar'
import { Toast } from './components/toast'
import { getCachedPcf, setCachedPcf } from './lib/cache'
import { setupDebugConsole } from './lib/debug'
import { getPcfApps, useGetAllApps } from './state/apps/queries'
import { type AppEntry, filterApps, type FilterMode } from './state/apps/types'
import { useAttestApp, useRevokeApp } from './state/attestations/mutations'
import { useGetAttestationsByContacts } from './state/attestations/queries'
import { addBookmark, getBookmarks, removeBookmark } from './state/bookmarks/api'
import { addContact, type ContactEntry, getContacts, removeContact } from './state/contacts/api'
import { addRecommended, getRecommended, removeRecommended } from './state/recommended/api'

export function App() {
  const queryClient = useQueryClient()
  const [pcfApps, setPcfApps] = useState<AppEntry[]>([])
  const [currentMode, setCurrentMode] = useState<FilterMode>('pcf')
  const [query, setQuery] = useState('')
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set())
  const [recommended, setRecommended] = useState<Set<string>>(new Set())
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastIsError, setToastIsError] = useState(false)
  const [toastAction, setToastAction] = useState<{ label: string; onClick: () => void } | null>(
    null
  )

  const [signed, setSigned] = useState(false)
  const [contacts, setContacts] = useState<ContactEntry[]>([])
  const [showContactsManager, setShowContactsManager] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)

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
  const { data: followedLabels = new Set<string>(), isFetching: followingLoading } =
    useGetAttestationsByContacts(allAppsCombined, contactAddresses)

  const attestApp = useAttestApp()
  const revokeApp = useRevokeApp()

  function navigateToDomain(label: string) {
    if (hostApi?.navigateTo) {
      hostApi.navigateTo({ tag: 'v1', value: `${label}.dot` })
    } else {
      window.open(`https://${label}.dot.li`, '_blank', 'noopener')
    }
  }

  function handleStar(label: string) {
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
  }

  function handleRecommend(label: string) {
    if (recommended.has(label)) {
      removeRecommended(label)
      setRecommended((prev) => {
        const next = new Set(prev)
        next.delete(label)
        return next
      })
      revokeApp.mutate(label, {
        onError: () => {
          addRecommended(label)
          setRecommended((prev) => new Set(prev).add(label))
        }
      })
    } else {
      addRecommended(label)
      setRecommended((prev) => new Set(prev).add(label))
      attestApp.mutate(label, {
        onSuccess: () => {
          setToastIsError(false)
          setToastMessage('Recommended!')
        },
        onError: () => {
          removeRecommended(label)
          setRecommended((prev) => {
            const next = new Set(prev)
            next.delete(label)
            return next
          })
        }
      })
    }
  }

  function handleAddContact(address: string, username?: string) {
    addContact(address, username)
    setContacts((prev) => [...prev, { address, username }])
  }

  function handleRemoveContact(address: string) {
    removeContact(address)
    setContacts((prev) => prev.filter((c) => c.address !== address))
  }

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
    getRecommended().then(setRecommended)
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

  useEffect(() => {
    async function loadPcf() {
      const cachedPcf = await getCachedPcf()
      if (cachedPcf.length > 0) {
        setPcfApps(cachedPcf)
      }

      getPcfApps().then((result) => {
        if (result.status === 'ok') {
          setPcfApps(result.apps)
          setCachedPcf(result.apps)
        }
      })
    }

    loadPcf()
  }, [])

  const filtered = filterApps(allAppsCombined, query, currentMode, bookmarks, followedLabels)
  const modeTotal = filterApps(allAppsCombined, '', currentMode, bookmarks, followedLabels).length
  const isLoading =
    currentMode === 'pcf' || currentMode === 'bookmarks'
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

  const otherTabHits =
    filtered.length === 0 && query
      ? (['pcf', 'bookmarks', 'following', 'all'] as FilterMode[])
          .filter((m) => m !== currentMode)
          .map((m) => ({
            mode: m,
            count: filterApps(allAppsCombined, query, m, bookmarks, followedLabels).length
          }))
          .filter((h) => h.count > 0)
      : []

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
            <CategoryTabs
              active={currentMode}
              signed={signed}
              onSwitch={(mode) => {
                setCurrentMode(mode)
                setShowContactsManager(false)
              }}
            />

            <div class='app-list' id='app-list'>
              {isLoading && filtered.length === 0 ? null : emptyBookmarks ? (
                <div class='empty-state'>
                  <div class='empty-state__icon'>
                    <svg width='32' height='32' viewBox='0 0 24 24' fill='none'>
                      <polygon
                        points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'
                        stroke='currentColor'
                        stroke-width='1.5'
                        stroke-linecap='round'
                        stroke-linejoin='round'
                      />
                    </svg>
                  </div>
                  <p class='empty-state__text'>No bookmarks yet</p>
                  <p class='empty-state__hint'>Tap the star on any app to save it here</p>
                </div>
              ) : emptyFollowingNoContacts ? (
                <div class='empty-state'>
                  <div class='empty-state__icon' style='color: rgba(255, 255, 255, 0.3)'>
                    <svg width='32' height='32' viewBox='0 0 24 24' fill='none'>
                      <path
                        d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'
                        stroke='currentColor'
                        stroke-width='1.5'
                        stroke-linecap='round'
                        stroke-linejoin='round'
                      />
                      <circle
                        cx='9'
                        cy='7'
                        r='4'
                        stroke='currentColor'
                        stroke-width='1.5'
                        stroke-linecap='round'
                        stroke-linejoin='round'
                      />
                      <line
                        x1='19'
                        y1='8'
                        x2='19'
                        y2='14'
                        stroke='currentColor'
                        stroke-width='1.5'
                        stroke-linecap='round'
                      />
                      <line
                        x1='22'
                        y1='11'
                        x2='16'
                        y2='11'
                        stroke='currentColor'
                        stroke-width='1.5'
                        stroke-linecap='round'
                      />
                    </svg>
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
              ) : filtered.length === 0 && query ? (
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
                  <button
                    class='empty-state__btn-ghost'
                    onClick={() => navigateToDomain(query.trim().toLowerCase())}
                  >
                    Visit {query.trim().toLowerCase()}.dot anyway
                  </button>
                  {otherTabHits.length > 0 ? (
                    <p class='empty-state__hint'>
                      Also found in{' '}
                      {otherTabHits.map((h, i) => (
                        <>
                          {i > 0 && ', '}
                          <a
                            class='empty-state__link'
                            href='#'
                            onClick={(e) => {
                              e.preventDefault()
                              setCurrentMode(h.mode)
                            }}
                          >
                            {h.mode.charAt(0).toUpperCase() + h.mode.slice(1)} ({h.count})
                          </a>
                        </>
                      ))}
                    </p>
                  ) : null}
                </div>
              ) : (
                filtered.map((app, i) => (
                  <ProductCard
                    key={app.label}
                    app={app}
                    index={i}
                    starred={bookmarks.has(app.label)}
                    recommended={recommended.has(app.label)}
                    showStar
                    onClick={navigateToDomain}
                    onStar={handleStar}
                    onRecommend={handleRecommend}
                  />
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
              {currentMode === 'following' && contacts.length > 0 && (
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
  )
}
