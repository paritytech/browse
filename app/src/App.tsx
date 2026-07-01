import { type VNode } from 'preact'

import { useDeferredValue } from 'preact/compat'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { createAccountsProvider } from '@novasamatech/host-api-wrapper'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Bookmark, Package } from 'lucide-preact'

import { CategoryTabs } from './components/category-tabs'
import { FollowingManager } from './components/following-manager'
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
import { useDomainSuggestions } from './lib/domains-snapshot'
import { navigateToDomain } from './lib/navigate'
import { subscribeHostTheme } from './lib/theme'
import { useEvent } from './lib/use-event'
import { useFlipReorder } from './lib/use-flip'
import { useOverscrollSync } from './lib/use-overscroll-sync'
import {
  ALL_APPS_KEY,
  LABELS_KEY,
  useGetAllApps,
  useLabelsStorage,
  useResolveLabel
} from './state/apps/queries'
import { type AppEntry, filterApps, type FilterMode, isFilterMode } from './state/apps/types'
import { follow, type FollowedAccount, getFollowing, unfollow } from './state/following/api'
import {
  useGetAttestationsByFollowing,
  useGetMyRecommendations
} from './state/recommendations/queries'

const SEARCH_GROUP_PRIORITY: FilterMode[] = ['bookmarks', 'following', 'all']

// Minimum time the loading dots stay up after a mobile pull-refresh, so the
// gesture has visible feedback even when the connection reset resolves instantly.
const PULL_REFRESH_MIN_VISIBLE_MS = 2000

/**
 * Render a snapshot-only search result as a product card, lazily resolving its
 * name and icon (the snapshot carries only the `.dot` domain). Published entries
 * already have their metadata and render directly via `renderCard`.
 */
function LazyResolvedCard({
  app,
  render
}: {
  app: AppEntry
  render: (app: AppEntry) => VNode
}): VNode {
  const { data } = useResolveLabel(app.label, true)
  return render(data ?? app)
}

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
  const [following, setFollowing] = useState<FollowedAccount[]>([])
  const [showFollowingManager, setShowFollowingManager] = useState(false)
  const [suggestionPrefix, setSuggestionPrefix] = useState('')
  // Touch devices get a minimum-visible hold on the dots after a pull-refresh.
  const [pullRefreshFloor, setPullRefreshFloor] = useState(false)
  // Nonce that commits the current display order into a sticky snapshot.
  const [orderNonce, setOrderNonce] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const appListRef = useRef<HTMLDivElement>(null)
  const pullFloorTimer = useRef<ReturnType<typeof setTimeout>>()
  const initialTabPicked = useRef(false)
  const heroLabelRef = useRef<string | null>(null)
  // Live source for the sticky order, refreshed each render below, read (not
  // depended on) by orderedLabels.
  const orderSourceRef = useRef<AppEntry[]>([])

  // Derived state and query data. This is one dependency chain, not a reorderable
  // set: each query feeds a memo that feeds the next, so the kinds necessarily
  // interleave. Coarse-pointer / no-hover device scopes the pull-refresh hold to
  // touch. Search renders product cards on every form factor.
  const isMobile = useMemo(
    () => !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches,
    []
  )
  const deferredQuery = useDeferredValue(query)
  const {
    data: allApps = [],
    isFetching: allFetching,
    isError: allError
  } = useGetAllApps(queryClient)
  const { data: labelDb } = useLabelsStorage()
  const followingAddresses = useMemo(() => following.map((account) => account.address), [following])
  const { data: followingApps = new Set<string>(), isLoading: followingLoading } =
    useGetAttestationsByFollowing(allApps, followingAddresses)
  // Apps the current user identity has recommended, by the same attester-to-
  // identity logic as the following set, so the recommend button reflects every
  // recommendation the identity made, across product accounts and resolvers.
  const { data: myRecommendations = new Set<string>() } = useGetMyRecommendations(allApps)
  // The following set actually shown. Additions land immediately. Removals from
  // unfollowing fade their cards out before leaving, like unbookmarking, so the
  // tab never blanks into skeletons.
  const [followingDisplay, setFollowingDisplay] = useState<Set<string>>(() => new Set())
  const followingDisplayRef = useRef(followingDisplay)
  followingDisplayRef.current = followingDisplay
  useEffect(() => {
    const shown = followingDisplayRef.current
    const added = [...followingApps].filter((label) => !shown.has(label))
    const removed = [...shown].filter((label) => !followingApps.has(label))
    if (added.length > 0) {
      setFollowingDisplay((prev) => {
        const next = new Set(prev)
        for (const label of added) next.add(label)
        return next
      })
    }
    if (removed.length === 0) return
    for (const label of removed) {
      const card = rootRef.current?.querySelector(`[data-label="${label}"]`) as HTMLElement | null
      card?.classList.add('product-card--removing')
    }
    const timer = setTimeout(() => {
      setFollowingDisplay((prev) => {
        const next = new Set(prev)
        for (const label of removed) next.delete(label)
        return next
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [followingApps])
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
    for (const label of followingDisplay) addLabel(label)
    for (const label of bookmarkedApps) addLabel(label)
    // The recommend button active state is identity-based: OR in the apps this
    // identity recommended, keeping any optimistic `hasUserAttested` from a
    // just-submitted recommendation.
    return [...byLabel.values()].map((app) =>
      myRecommendations.has(app.label) && !app.hasUserAttested
        ? { ...app, hasUserAttested: true }
        : app
    )
  }, [allApps, followingDisplay, bookmarkedApps, labelDb, myRecommendations])
  // Labels from the Publisher set, used to scope the All tab to published apps
  // only (bookmarked/followed entries belong to their own tabs).
  const publishedLabels = useMemo(() => new Set(allApps.map((app) => app.label)), [allApps])
  const filtered = useMemo(() => {
    const result = filterApps(
      appsForFiltering,
      deferredQuery,
      currentMode,
      bookmarkedApps,
      followingDisplay,
      publishedLabels
    )
    if (currentMode === 'all' && !deferredQuery.trim()) {
      return result.filter((app) => app.label !== SELF_LABEL)
    }
    return result
  }, [
    appsForFiltering,
    deferredQuery,
    currentMode,
    bookmarkedApps,
    followingDisplay,
    publishedLabels
  ])
  orderSourceRef.current = filtered
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
        followingDisplay,
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
  }, [deferredQuery, appsForFiltering, bookmarkedApps, followingDisplay, publishedLabels])
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
  // Domain-snapshot suggestion prefix: the raw query (trailing `.dot` stripped,
  // lowercased), debounced ~150ms into suggestionPrefix by an effect below. A
  // local snapshot lookup, independent of the 500ms debouncedQuery.
  const suggestionPrefixSource = query
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
  const { data: domainSuggestions = [] } = useDomainSuggestions(suggestionPrefix)
  // Merge the search results shown while typing: published matches (with real
  // metadata and icons) first, then every other `.dot` name from the snapshot
  // as a minimal entry (Identicon and `<label>.dot`). Deduped by label.
  const searchEntries = useMemo<{ app: AppEntry; snapshotOnly: boolean }[]>(() => {
    if (!searchMatches) return []
    const published = [
      ...searchMatches,
      ...(resolvedApp && !searchMatches.some((app) => app.label === resolvedApp.label)
        ? [resolvedApp]
        : [])
    ]
    const known = new Set(published.map((app) => app.label))
    known.add(SELF_LABEL)
    const snapshotOnly = domainSuggestions
      .filter((label) => !known.has(label))
      .map((label) => ({
        app: {
          label,
          name: null,
          description: 'No description',
          iconCid: null,
          contentHash: null,
          isLive: false,
          attestationCount: null,
          hasUserAttested: false,
          isCompliant: false
        } satisfies AppEntry,
        snapshotOnly: true
      }))
    return [...published.map((app) => ({ app, snapshotOnly: false })), ...snapshotOnly]
  }, [searchMatches, resolvedApp, domainSuggestions])
  // True while a search is in flight: typing hasn't settled (debounce or
  // useDeferredValue), or the on-chain resolver is fetching.
  const isSearching =
    query.length > 0 &&
    (deferredQuery !== query ||
      debouncedQuery !== query ||
      (resolverLabel.length >= 3 && resolverFetching))
  const isLoading =
    currentMode === 'bookmarks'
      ? false
      : currentMode === 'following'
        ? followingLoading
        : allFetching
  // Loading dots track the live sync. A mobile pull-refresh additionally holds
  // them for a minimum window so the gesture doesn't flash.
  const showSyncDots = (isLoading && !query && filtered.length > 0) || pullRefreshFloor
  // Showing skeletons.
  const coldStart = isLoading && filtered.length === 0 && !query
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
  const handleFollow = useEvent((address: string, username?: string) => {
    follow(address, username)
    setFollowing((prev) => [...prev, { address, username }])
  })
  const handleUnfollow = useEvent((address: string) => {
    unfollow(address)
    setFollowing((prev) => prev.filter((account) => account.address !== address))
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
  // Completely re-establish the chain connection: drop the cached SDK (destroys
  // the papi client + chain socket) so the next query rebuilds a fresh
  // connection, then refetch. Driven by the overscroll-at-bottom gesture. On
  // touch, hold the loading dots for a minimum window so the pull always reads
  // as feedback even if the reset resolves instantly.
  const refreshConnection = useEvent(() => {
    resetBrowseSdk()
    if (isMobile) {
      clearTimeout(pullFloorTimer.current)
      setPullRefreshFloor(true)
      pullFloorTimer.current = setTimeout(
        () => setPullRefreshFloor(false),
        PULL_REFRESH_MIN_VISIBLE_MS
      )
    }
    void queryClient.invalidateQueries({ queryKey: ALL_APPS_KEY })
  })
  const commitOrder = useEvent((label: string) => {
    heroLabelRef.current = label
    setOrderNonce((n) => n + 1)
  })

  // Debounce the snapshot-suggestion prefix ~150ms behind the raw query.
  useEffect(() => {
    const id = setTimeout(() => setSuggestionPrefix(suggestionPrefixSource), 150)
    return () => clearTimeout(id)
  }, [suggestionPrefixSource])
  // Persist resolvedApp into the labels DB so a later bookmark/follow can render
  // with full metadata even after reload.
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
  // Subscribe to account connection status.
  useEffect(() => {
    const provider = createAccountsProvider()
    const sub = provider.subscribeAccountConnectionStatus((status) => {
      setSigned(status === 'connected')
    })
    return () => sub.unsubscribe()
  }, [])
  useEffect(() => subscribeHostTheme(), [])
  useEffect(() => () => clearTimeout(pullFloorTimer.current), [])
  // Surface a network failure as a (non-error) toast.
  useEffect(() => {
    if (allError) {
      showToast('Network connection failed')
    }
  }, [allError, showToast])
  // Load bookmarks and the following list on mount.
  useEffect(() => {
    readBookmarks().then((bookmark) => {
      setBookmarkedApps(new Set(bookmark))
      setBookmarkedAppsLoaded(true)
    })
    getFollowing().then(setFollowing)
  }, [])
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
  // Pushing past the end of the list fully re-establishes the chain connection
  // (resetBrowseSdk) and re-syncs. Disabled while a sync runs, while searching,
  // or on the local bookmarks tab.
  useOverscrollSync(refreshConnection, allFetching || !!query || currentMode === 'bookmarks')
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
  const emptyFollowingNobody =
    currentMode === 'following' && following.length === 0 && filtered.length === 0 && !query
  const emptyFollowingNoMatches =
    currentMode === 'following' &&
    following.length > 0 &&
    filtered.length === 0 &&
    !query &&
    !followingLoading
  const emptyAll = currentMode === 'all' && filtered.length === 0 && !query && !allFetching

  return (
    <ToastContext.Provider value={{ showToast }}>
      <div class='page' ref={rootRef}>
        <div class='main'>
          <div class='card-flip' id='card-flip'>
            <div class='card front' id='card-front'>
              <div class='topbar'>
                <SearchBar value={query} onInput={setQuery} onCancel={() => setQuery('')} />
              </div>
              {!searchMatches && (
                <CategoryTabs
                  active={coldStart ? ['all'] : [currentMode]}
                  disabled={coldStart}
                  onSwitch={(mode) => {
                    setCurrentMode(mode)
                    setShowFollowingManager(false)
                  }}
                />
              )}

              <div class='app-list' id='app-list' ref={appListRef}>
                {coldStart ? (
                  Array.from({ length: 6 }, (_, i) => <ProductCardSkeleton key={`sk-${i}`} />)
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
                ) : emptyFollowingNobody ? (
                  <div class='empty-state'>
                    <div class='empty-state__icon empty-state__icon--faint'>{FOLLOW_ICON}</div>
                    <p class='empty-state__text'>
                      Follow people to see what they recommend{' '}
                      <ArrowUp size={14} class='empty-state__inline-icon' />
                    </p>
                    <button class='empty-state__btn' onClick={() => setShowFollowingManager(true)}>
                      Add Person
                    </button>
                  </div>
                ) : emptyFollowingNoMatches ? (
                  <div class='empty-state'>
                    <p class='empty-state__text'>
                      None of the people you follow have recommended{' '}
                      <ArrowUp size={14} class='empty-state__inline-icon' /> any products yet
                    </p>
                  </div>
                ) : searchMatches && searchEntries.length > 0 ? (
                  // Search results render as product cards on both form factors.
                  // Snapshot-only labels resolve their name and icon lazily.
                  // Published entries render directly.
                  searchEntries.map(({ app, snapshotOnly }, i) =>
                    snapshotOnly ? (
                      <LazyResolvedCard
                        key={app.label}
                        app={app}
                        render={(resolved) => renderCard(resolved, i)}
                      />
                    ) : (
                      renderCard(app, i)
                    )
                  )
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
                  orderedFiltered.map((app, i) => renderCard(app, i))
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

              {currentMode === 'following' &&
                (following.length > 0 || followingDisplay.size > 0) && (
                  <button
                    type='button'
                    class='corner-chip corner-chip--manage'
                    onClick={() => setShowFollowingManager(true)}
                    aria-label={`Manage following, ${following.length} address${following.length === 1 ? '' : 'es'}`}
                  >
                    <span class='corner-chip__label'>Following</span>
                    {following.length > 0 && (
                      <span class='corner-chip__addr'>{following.length}</span>
                    )}
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

        <FollowingManager
          following={following}
          visible={showFollowingManager}
          onAdd={handleFollow}
          onRemove={handleUnfollow}
          onDismiss={() => setShowFollowingManager(false)}
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
