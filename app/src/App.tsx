import { useDeferredValue } from 'preact/compat'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { createAccountsProvider } from '@novasamatech/host-api-wrapper'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Bookmark, Package } from 'lucide-preact'

import { CategoryTabs } from './components/category-tabs'
import { ContactsManager } from './components/contacts-manager'
import { FOLLOW_ICON, SEARCH_ICON } from './components/icons'
import { ProductCardWithAttestation } from './components/product-card/product-card-with-attestation'
import { ProductCardSkeleton } from './components/product-card/skeleton'
import { SearchBar } from './components/search-bar'
import { Toast } from './components/toast'
import { ToastContext } from './components/toast/context'
import { createBookmark, deleteBookmark, readBookmarks } from './db/bookmarks'
import { upsertLabel } from './db/labels'
import { resetBrowseSdk } from './lib/client'
import { SELF_LABEL } from './lib/config'
import { setupDebugConsole } from './lib/debug'
import { navigateToDomain } from './lib/navigate'
import { subscribeHostTheme } from './lib/theme'
import { useEvent } from './lib/use-event'
import { useFlipReorder } from './lib/use-flip'
import { useOverscrollSync } from './lib/use-overscroll-sync'
import { useSyncIndicator } from './lib/use-sync-indicator'
import {
  ALL_APPS_KEY,
  LABELS_KEY,
  useGetAllApps,
  useLabelsStorage,
  useResolveLabel
} from './state/apps/queries'
import { type AppEntry, filterApps, type FilterMode, isFilterMode } from './state/apps/types'
import { useGetAttestationsByContacts } from './state/attestations/queries'
import { addContact, type ContactEntry, getContacts, removeContact } from './state/contacts/api'

const SEARCH_GROUP_PRIORITY: FilterMode[] = ['bookmarks', 'following', 'all']

export function App() {
  const queryClient = useQueryClient()

  const [currentMode, setCurrentMode] = useState<FilterMode>('all')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [bookmarkedApps, setBookmarkedApps] = useState<Set<string>>(() => new Set())
  const [bookmarkedAppsLoaded, setBookmarkedAppsLoaded] = useState(false)
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
  const appListRef = useRef<HTMLDivElement>(null)

  const {
    data: allApps = [],
    isFetching: allFetching,
    isError: allError
  } = useGetAllApps(queryClient)
  const { data: labelDb } = useLabelsStorage()
  const contactAddresses = useMemo(() => contacts.map((contact) => contact.address), [contacts])

  const { data: followingApps = new Set<string>(), isLoading: followingLoading } =
    useGetAttestationsByContacts(allApps, contactAddresses)

  const appsForFiltering = useMemo(() => {
    const byLabel = new Map<string, AppEntry>()
    for (const app of allApps) byLabel.set(app.label, app)
    const addLabel = (label: string) => {
      if (byLabel.has(label)) return
      // Pull metadata from the labels DB when available. Covers labels
      // outside the Publisher set (bookmarked search results, followed-only).
      const cached = labelDb?.get(label)
      byLabel.set(label, {
        label,
        name: cached?.name ?? null,
        description: cached?.description ?? 'No description',
        iconCid: cached?.iconCid ?? null,
        contentHash: cached?.contentHash ?? null,
        isLive: cached?.contentHash != null,
        attestationCount: cached?.attestationCount ?? null,
        hasUserAttested: cached?.hasUserAttested ?? false,
        isCompliant: cached?.isCompliant ?? false
      })
    }
    for (const label of followingApps) addLabel(label)
    for (const label of bookmarkedApps) addLabel(label)
    return [...byLabel.values()]
  }, [allApps, followingApps, bookmarkedApps, labelDb])

  // Labels that came from the Publisher set, used to scope the All tab to
  // published apps only (bookmarked/followed entries belong to their own tabs).
  const publishedLabels = useMemo(() => new Set(allApps.map((app) => app.label)), [allApps])

  const filtered = useMemo(() => {
    const result = filterApps(
      appsForFiltering,
      deferredQuery,
      currentMode,
      bookmarkedApps,
      followingApps,
      publishedLabels
    )
    if (currentMode === 'all' && !deferredQuery.trim()) {
      return result.filter((app) => app.label !== SELF_LABEL)
    }
    return result
  }, [appsForFiltering, deferredQuery, currentMode, bookmarkedApps, followingApps, publishedLabels])
  // While the user is typing, search ignores tabs.
  const searchMatches = useMemo<AppEntry[] | null>(() => {
    if (!deferredQuery.trim()) return null
    const seen = new Set<string>()
    const matches: AppEntry[] = []
    for (const mode of SEARCH_GROUP_PRIORITY) {
      const modeMatches = filterApps(
        appsForFiltering,
        deferredQuery,
        mode,
        bookmarkedApps,
        followingApps,
        publishedLabels
      )
      for (const app of modeMatches) {
        if (seen.has(app.label)) continue
        seen.add(app.label)
        matches.push(app)
      }
    }
    // The app itself (SELF_LABEL, derived from APP_DOTNS_DOMAIN) only belongs in
    // search on an exact name match, the label or `<label>.dot`. Never as a
    // partial/substring hit.
    const normalizedQuery = deferredQuery
      .trim()
      .toLowerCase()
      .replace(/\.dot$/, '')
    const exactSelf = normalizedQuery === SELF_LABEL
    return exactSelf ? matches : matches.filter((app) => app.label !== SELF_LABEL)
  }, [deferredQuery, appsForFiltering, bookmarkedApps, followingApps, publishedLabels])

  const tryLabel = query
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
  const resolverLabel = debouncedQuery
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
  const shouldResolve = debouncedQuery === query && resolverLabel.length >= 3
  const { data: resolvedApp, isFetching: resolverFetching } = useResolveLabel(
    resolverLabel,
    shouldResolve
  )
  // True while a search is in flight: typing hasn't settled (debounce or
  // useDeferredValue), or the on-chain resolver is fetching.
  const isSearching =
    query.length > 0 &&
    (deferredQuery !== query ||
      debouncedQuery !== query ||
      (resolverLabel.length >= 3 && resolverFetching))

  // Persist resolvedApp into the labels DB so a later bookmark/follow can
  // render with full metadata even after reload.
  useEffect(() => {
    if (!resolvedApp) return
    void upsertLabel({
      label: resolvedApp.label,
      name: resolvedApp.name,
      description: resolvedApp.description,
      iconCid: resolvedApp.iconCid,
      contentHash: resolvedApp.contentHash,
      attestationCount: resolvedApp.attestationCount,
      hasUserAttested: resolvedApp.hasUserAttested,
      isCompliant: resolvedApp.isCompliant,
      fetchedAt: Date.now(),
      // A resolved search result is NOT confirmed against the Publisher set, so
      // mark it unpublished. Otherwise materialize() would surface it in the
      // All tab until the next sync prunes it. A sync flips this to true if it
      // really is published.
      published: false
    }).then(() => queryClient.invalidateQueries({ queryKey: LABELS_KEY }))
  }, [resolvedApp, queryClient])

  // Snapshot the current AppEntry into the labels DB so the bookmark survives
  // reloads with full metadata.
  const persistLabelFromApp = useEvent(async (app: AppEntry) => {
    await upsertLabel({
      label: app.label,
      name: app.name,
      description: app.description,
      iconCid: app.iconCid,
      contentHash: app.contentHash,
      attestationCount: app.attestationCount,
      hasUserAttested: app.hasUserAttested,
      isCompliant: app.isCompliant,
      fetchedAt: Date.now()
    })
    await queryClient.invalidateQueries({ queryKey: LABELS_KEY })
  })

  const handleBookmark = useEvent((label: string) => {
    if (bookmarkedApps.has(label)) {
      // Animate card out, then remove from bookmarks
      const card = rootRef.current?.querySelector(`[data-label="${label}"]`) as HTMLElement | null
      const doRemove = () => {
        deleteBookmark(label)
        setBookmarkedApps((prev) => {
          const next = new Set(prev)
          next.delete(label)
          return next
        })
      }
      if (card && currentMode === 'bookmarks' && !searchMatches) {
        card.classList.add('product-card--removing')
        setTimeout(doRemove, 400)
      } else {
        doRemove()
      }
      setToastIsError(false)
      setToastAction(null)
      setToastMessage('App unbookmarked.')
    } else {
      createBookmark(label)
      setBookmarkedApps((prev) => new Set(prev).add(label))
      setToastIsError(false)
      setToastAction(null)
      setToastMessage('App bookmarked.')
      const app = appsForFiltering.find((entry) => entry.label === label)
      if (app) void persistLabelFromApp(app)
    }
  })
  const showToast = useEvent(
    (
      message: string,
      isError = false,
      action: { label: string; onClick: () => void } | null = null
    ) => {
      setToastIsError(isError)
      setToastAction(action)
      setToastMessage(message)
    }
  )

  const handleAddContact = useEvent((address: string, username?: string) => {
    addContact(address, username)
    setContacts((prev) => [...prev, { address, username }])
  })
  const handleRemoveContact = useEvent((address: string) => {
    removeContact(address)
    setContacts((prev) => prev.filter((contact) => contact.address !== address))
  })

  const handleShare = useEvent(async (app: AppEntry) => {
    const domain = `${app.label}.dot`
    const hasDescription = app.description && app.description !== 'No description'
    const header = [app.name, hasDescription ? app.description : null].filter(Boolean).join(', ')
    const text = header ? `${header}\n${domain}` : domain

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: app.name ?? undefined, text })
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
      }
    }

    try {
      await navigator.clipboard.writeText(text)
      showToast('Copied to clipboard')
    } catch {
      showToast('Could not copy to clipboard')
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

  useEffect(() => subscribeHostTheme(), [])

  // Completely re-establish the chain connection: drop the cached SDK (destroys
  // the papi client + chain socket) so the next query rebuilds a fresh
  // connection, then refetch. Driven by the overscroll-at-bottom gesture.
  const refreshConnection = useEvent(() => {
    resetBrowseSdk()
    void queryClient.invalidateQueries({ queryKey: ALL_APPS_KEY })
  })

  // Surface a network failure as a (non-error) toast.
  useEffect(() => {
    if (allError) {
      showToast('Network connection failed')
    }
  }, [allError, showToast])

  // Load bookmarks and contacts on mount
  useEffect(() => {
    readBookmarks().then((bookmark) => {
      setBookmarkedApps(new Set(bookmark))
      setBookmarkedAppsLoaded(true)
    })
    getContacts().then(setContacts)
  }, [])

  const initialTabPicked = useRef(false)
  useEffect(() => {
    if (!bookmarkedAppsLoaded || initialTabPicked.current) return
    initialTabPicked.current = true
    const hash = location.hash.slice(1).toLowerCase()
    if (isFilterMode(hash)) return
    setCurrentMode(bookmarkedApps.size > 0 ? 'bookmarks' : 'all')
  }, [bookmarkedAppsLoaded, bookmarkedApps])

  useEffect(() => {
    function onHashChange() {
      const segment = location.hash.slice(1).toLowerCase()
      if (isFilterMode(segment)) setCurrentMode(segment)
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
    currentMode === 'bookmarks'
      ? false
      : currentMode === 'following'
        ? followingLoading
        : allFetching

  // Pushing past the end of the list fully re-establishes the chain connection
  // (resetBrowseSdk) and re-syncs. Disabled while a sync runs, while searching,
  // or on the local bookmarks tab.
  useOverscrollSync(refreshConnection, allFetching || !!query || currentMode === 'bookmarks')

  // The sync indicator (loading dots): swallow the open-time sync on desktop and
  // hold the dots for a minimum duration so a fast sync doesn't flash.
  const showSyncDots = useSyncIndicator(isLoading && !query && filtered.length > 0)

  // Showing skeletons.
  const coldStart = isLoading && filtered.length === 0 && !query

  // Sticky display order.
  const [orderNonce, setOrderNonce] = useState(0)
  const heroLabelRef = useRef<string | null>(null)
  const commitOrder = useEvent((label: string) => {
    heroLabelRef.current = label
    setOrderNonce((n) => n + 1)
  })

  const orderSourceRef = useRef<AppEntry[]>(filtered)
  orderSourceRef.current = filtered

  const membershipKey = useMemo(
    () =>
      `${currentMode}:${filtered
        .map((app) => app.label)
        .sort()
        .join(',')}`,
    [currentMode, filtered]
  )

  const orderedLabels = useMemo(
    () => orderSourceRef.current.map((app) => app.label),
    [membershipKey, orderNonce]
  )

  // Apply the sticky order to the live entries, so counts stay optimistic while
  // positions hold until commit.
  const orderedFiltered = useMemo(() => {
    const byLabel = new Map(filtered.map((app) => [app.label, app]))
    return orderedLabels
      .map((label) => byLabel.get(label))
      .filter((app): app is AppEntry => app != null)
  }, [orderedLabels, filtered])

  const flipKey = useMemo(() => {
    if (searchMatches) {
      return `s:${searchMatches.map((app) => app.label).join(',')}:${resolvedApp?.label ?? ''}`
    }
    return `f:${currentMode}:${orderedFiltered.map((app) => app.label).join(',')}`
  }, [searchMatches, resolvedApp, currentMode, orderedFiltered])
  useFlipReorder(appListRef, flipKey, heroLabelRef)

  const renderCard = (app: AppEntry, i: number) => (
    <ProductCardWithAttestation
      key={app.label}
      app={app}
      index={i}
      bookmarked={bookmarkedApps.has(app.label)}
      isSignedIn={signed}
      showMenu
      onClick={navigateToDomain}
      onBookmark={handleBookmark}
      onShare={handleShare}
      onAttestationSettled={() => commitOrder(app.label)}
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
  const emptyAll = currentMode === 'all' && filtered.length === 0 && !query && !allFetching

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
              <SearchBar value={query} onInput={setQuery} onCancel={() => setQuery('')} />
              {!searchMatches && (
                <CategoryTabs
                  active={coldStart ? ['all'] : [currentMode]}
                  isSignedIn={signed}
                  disabled={coldStart}
                  onSwitch={(mode) => {
                    setCurrentMode(mode)
                    setShowContactsManager(false)
                  }}
                />
              )}

              <div class='app-list' id='app-list' ref={appListRef}>
                {coldStart ? (
                  Array.from({ length: 4 }, (_, i) => <ProductCardSkeleton key={`sk-${i}`} />)
                ) : emptyAll ? (
                  <div class='empty-state'>
                    <div class='empty-state__icon'>
                      <Package size={32} />
                    </div>
                    <p class='empty-state__text'>No apps published yet</p>
                  </div>
                ) : emptyBookmarks ? (
                  <div class='empty-state'>
                    <div class='empty-state__icon'>
                      <Bookmark size={32} />
                    </div>
                    <p class='empty-state__text'>No bookmarks yet</p>
                  </div>
                ) : emptyFollowingNoContacts ? (
                  <div class='empty-state'>
                    <div class='empty-state__icon empty-state__icon--faint'>{FOLLOW_ICON}</div>
                    <p class='empty-state__text'>
                      Follow people to see what they recommend{' '}
                      <ArrowUp size={14} class='empty-state__inline-icon' />
                    </p>
                    <button class='empty-state__btn' onClick={() => setShowContactsManager(true)}>
                      Add address
                    </button>
                  </div>
                ) : emptyFollowingNoMatches ? (
                  <div class='empty-state'>
                    <p class='empty-state__text'>
                      None of the people you follow have recommended{' '}
                      <ArrowUp size={14} class='empty-state__inline-icon' /> any products yet
                    </p>
                  </div>
                ) : searchMatches && (searchMatches.length > 0 || resolvedApp) ? (
                  [
                    ...searchMatches,
                    ...(resolvedApp && !searchMatches.some((app) => app.label === resolvedApp.label)
                      ? [resolvedApp]
                      : [])
                  ].map(renderCard)
                ) : searchMatches ? (
                  isSearching ? (
                    <div class='empty-state'>
                      <p class='empty-state__text'>Searching for "{query}"…</p>
                      <div class='loading-dots loading-dots--inline'>
                        <span class='loading-dots__dot' />
                        <span class='loading-dots__dot' />
                        <span class='loading-dots__dot' />
                      </div>
                    </div>
                  ) : (
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
                  )
                ) : (
                  orderedFiltered.map(renderCard)
                )}
              </div>

              <div
                class='loading-dots'
                id='loading-dots'
                style={{ display: showSyncDots ? 'flex' : 'none' }}
              >
                <span class='loading-dots__dot' />
                <span class='loading-dots__dot' />
                <span class='loading-dots__dot' />
              </div>

              {currentMode === 'following' && contacts.length > 0 && (
                <button
                  type='button'
                  class='corner-chip corner-chip--manage'
                  onClick={() => setShowContactsManager(true)}
                  aria-label={`Manage following, ${contacts.length} address${contacts.length === 1 ? '' : 'es'}`}
                >
                  <span class='corner-chip__label'>Following</span>
                  <span class='corner-chip__addr'>{contacts.length}</span>
                </button>
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
