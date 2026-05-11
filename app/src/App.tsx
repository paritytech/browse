import { useDeferredValue } from 'preact/compat'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { createAccountsProvider } from '@novasamatech/product-sdk'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowBigUp, Bookmark, MoreHorizontal } from 'lucide-preact'

import { CategoryTabs } from './components/category-tabs'
import { ContactsManager } from './components/contacts-manager'
import { FOLLOW_ICON, SEARCH_ICON } from './components/icons'
import { ProductCardWithAttestation } from './components/product-card/product-card-with-attestation'
import { SearchBar } from './components/search-bar'
import { Toast } from './components/toast'
import { ToastContext } from './components/toast/context'
import { readAllStores } from './db/stores'
import { setupDebugConsole } from './lib/debug'
import { navigateToDomain } from './lib/navigate'
import { useEvent } from './lib/use-event'
import { useGetAllApps, useGetPcfApps, useResolveLabel } from './state/apps/queries'
import { type AppEntry, filterApps, type FilterMode } from './state/apps/types'
import { useGetAttestationsByContacts } from './state/attestations/queries'
import { addBookmark, getBookmarks, removeBookmark } from './state/bookmarks/api'
import { addContact, type ContactEntry, getContacts, removeContact } from './state/contacts/api'

const SEARCH_GROUP_PRIORITY: FilterMode[] = ['bookmarks', 'following', 'pcf', 'all']

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
  const deferredQuery = useDeferredValue(query)

  const rootRef = useRef<HTMLDivElement>(null)

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
  // While the user is typing, search ignores tabs: matches across every source
  // are flattened into a single list, ordered by primary source (bookmarks
  // first, then following, then pcf, then all). Each app appears once.
  const searchMatches = useMemo<AppEntry[] | null>(() => {
    if (!deferredQuery.trim()) return null
    const seen = new Set<string>()
    const matches: AppEntry[] = []
    for (const mode of SEARCH_GROUP_PRIORITY) {
      const m = filterApps(allAppsCombined, deferredQuery, mode, bookmarks, followedLabels)
      for (const app of m) {
        if (seen.has(app.label)) continue
        seen.add(app.label)
        matches.push(app)
      }
    }
    return matches
  }, [deferredQuery, allAppsCombined, bookmarks, followedLabels])

  const tryLabel = query
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
  const resolverLabel = debouncedQuery
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
  const shouldResolve =
    debouncedQuery === query && searchMatches?.length === 0 && resolverLabel.length > 0
  const { data: resolvedApp } = useResolveLabel(resolverLabel, shouldResolve)

  const handleBookmark = useEvent((label: string) => {
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

  const handleFollowPublisher = useEvent(async (label: string) => {
    const stores = await readAllStores()
    const store = stores.find((s) => s.labels.includes(label))
    const address = store?.ownerSS58Address
    if (!address) {
      showToast('Publisher address unavailable', true)
      return
    }
    if (contacts.some((c) => c.address === address)) {
      showToast('Already following this publisher')
      return
    }
    handleAddContact(address)
    showToast('Now following publisher')
  })

  const handleShare = useEvent(async (app: AppEntry) => {
    const domain = `${app.label}.dot`
    const hasDescription = app.description && app.description !== 'No description'
    const header = [app.name, hasDescription ? app.description : null].filter(Boolean).join(', ')
    const text = header ? `${header}\n${domain}` : domain
    try {
      await navigator.clipboard.writeText(text)
      showToast('Copied to clipboard')
    } catch {
      showToast('Could not copy to clipboard', true)
    }
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
  const renderCard = (app: AppEntry, i: number) => (
    <ProductCardWithAttestation
      key={app.label}
      app={app}
      index={i}
      bookmarked={bookmarks.has(app.label)}
      showMenu
      onClick={navigateToDomain}
      onBookmark={handleBookmark}
      onFollowPublisher={handleFollowPublisher}
      onShare={handleShare}
    />
  )

  const emptyBookmarks = currentMode === 'bookmarks' && filtered.length === 0 && !query
  const emptyFollowingNoContacts = currentMode === 'following' && contacts.length === 0 && !query
  const emptyFollowingNoMatches =
    currentMode === 'following' &&
    contacts.length > 0 &&
    filtered.length === 0 &&
    !query &&
    !followingLoading

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
                active={searchMatches ? [] : [currentMode]}
                signed={signed}
                onSwitch={(mode) => {
                  setCurrentMode(mode)
                  setQuery('')
                  setShowContactsManager(false)
                }}
              />

              <div class='app-list' id='app-list'>
                {isLoading && filtered.length === 0 && !query ? null : emptyBookmarks ? (
                  <div class='empty-state'>
                    <div class='empty-state__icon'>
                      <Bookmark size={32} />
                    </div>
                    <p class='empty-state__text'>No bookmarks yet</p>
                    <p class='empty-state__hint'>
                      Open the <MoreHorizontal size={14} class='empty-state__inline-icon' /> menu on
                      a product and tap <Bookmark size={14} class='empty-state__inline-icon' /> to
                      save it here
                    </p>
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
                      None of the addresses you follow have recommended{' '}
                      <ArrowBigUp size={14} class='empty-state__inline-icon' /> any apps yet
                    </p>
                    <button class='empty-state__btn' onClick={() => setShowContactsManager(true)}>
                      Manage following
                    </button>
                  </div>
                ) : searchMatches && searchMatches.length > 0 ? (
                  searchMatches.map(renderCard)
                ) : searchMatches && resolvedApp ? (
                  renderCard(resolvedApp, 0)
                ) : searchMatches ? (
                  <div class='empty-state'>
                    <div class='empty-state__icon'>{SEARCH_ICON}</div>
                    <p class='empty-state__text'>No products matching "{query}"</p>
                    <button
                      class='empty-state__btn-ghost'
                      onClick={() => navigateToDomain(tryLabel)}
                    >
                      Try {tryLabel}.dot anyway
                    </button>
                  </div>
                ) : (
                  filtered.map(renderCard)
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

              {currentMode === 'following' && contacts.length > 0 && !emptyFollowingNoMatches && (
                <div class='list-count'>
                  <button class='list-count__manage' onClick={() => setShowContactsManager(true)}>
                    Manage following
                  </button>
                </div>
              )}
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
