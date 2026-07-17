import { type VNode } from 'preact'

import { useDeferredValue } from 'preact/compat'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'

import { createAccountsProvider } from '@novasamatech/host-api-wrapper'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUp, Bookmark, MoreVertical, Package, X } from 'lucide-preact'

import { CategoryTabs } from './components/category-tabs'
import { CertificateAuthorityManager } from './components/certificate-authority-manager'
import { CertificateBadge } from './components/certificate-badge'
import { CertificateModal } from './components/certificate-modal'
import { FollowingManager } from './components/following-manager'
import { FOLLOW_ICON, SEARCH_ICON } from './components/icons'
import { ProductCardWithAttestation } from './components/product-card/product-card-with-attestation'
import { ProductCardSkeleton } from './components/product-card/skeleton'
import { RecommendPrompt } from './components/recommend-prompt'
import { SearchBar } from './components/search-bar'
import { Toast } from './components/toast'
import { ToastContext } from './components/toast/context'
import { createBookmark, deleteBookmark, readBookmarks } from './db/bookmarks'
import { upsertLabel } from './db/labels'
import { useEvent } from './hooks/use-event'
import { useFlipReorder } from './hooks/use-flip'
import { useOverscrollSync } from './hooks/use-overscroll-sync'
import { resetBrowseSdk } from './lib/client'
import { SELF_LABEL } from './lib/config'
import { setupDebugConsole } from './lib/debug'
import { useDomainSuggestions } from './lib/domains-snapshot'
import { navigateToDomain } from './lib/navigate'
import { clearPendingRecommend, readPendingRecommends } from './lib/pending-recommend'
import { shareLink } from './lib/share-link'
import { subscribeHostTheme } from './lib/theme'
import {
  ALL_APPS_KEY,
  LABELS_KEY,
  useGetAllApps,
  useLabelsStorage,
  useResolveLabel
} from './state/apps/queries'
import {
  type AppCertificate,
  type AppEntry,
  filterApps,
  type FilterMode,
  isFilterMode
} from './state/apps/types'
import {
  useCertificateAuthorities,
  useSelectedCertificateAuthorities
} from './state/certificate-authorities/queries'
import { follow, type FollowedAccount, getFollowing, unfollow } from './state/following/api'
import { describeError, useAttestProduct } from './state/recommendations/mutations'
import {
  useGetAttestationsByFollowing,
  useGetMyRecommendations
} from './state/recommendations/queries'

const SEARCH_GROUP_PRIORITY: FilterMode[] = ['bookmarks', 'following', 'all']

// Number of certificate-authority badge marks shown in the menu before the rest
// collapse into a `+N` chip.
const MENU_BADGE_LIMIT = 3

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
  const attestProduct = useAttestProduct()

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
  // The ⋮ trigger at the trailing edge of the category tabs opens a small
  // anchored popover. The back arrow returns to the menu.
  // The cross closes the whole popover.
  const [menuOpen, setMenuOpen] = useState(false)
  const [view, setView] = useState<'menu' | 'following' | 'badges'>('menu')
  // Fixed viewport coordinates for the popover, measured off the trigger on open.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  // The popover height, animated to the measured content height of the active
  // view so the modal expands and collapses smoothly between the menu and a
  // manager.
  const [popoverHeight, setPopoverHeight] = useState<number>()
  const [suggestionPrefix, setSuggestionPrefix] = useState('')
  // Touch devices get a minimum-visible hold on the dots after a pull-refresh.
  const [pullRefreshFloor, setPullRefreshFloor] = useState(false)
  // Nonce that commits the current display order into a sticky snapshot.
  const [orderNonce, setOrderNonce] = useState(0)
  const [certificateModalOpen, setCertificateModalOpen] = useState(false)
  // The last-opened certificate subject and attestation details. Kept after
  // close so the content stays put through the collapse animation instead of
  // clearing mid-transition.
  const [certificateView, setCertificateView] = useState<{
    subjectName: string | null
    subjectDomain: string
    certificate: AppCertificate | null
  } | null>(null)
  // A deferred "did you like it?" prompt for an app the user was sent to from a
  // share link, surfaced on a later visit (see the pending-recommend store).
  const [recommendPrompt, setRecommendPrompt] = useState<{
    label: string
    from?: string
  } | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const appListRef = useRef<HTMLDivElement>(null)
  const pullFloorTimer = useRef<ReturnType<typeof setTimeout>>()
  const initialTabPicked = useRef(false)
  const heroLabelRef = useRef<string | null>(null)
  // Live source for the sticky order, refreshed each render below, read (not
  // depended on) by orderedLabels.
  const orderSourceRef = useRef<AppEntry[]>([])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Natural-height inner of each view, measured to animate the popover height as
  // it expands from the menu into a manager and back.
  const menuInnerRef = useRef<HTMLDivElement>(null)
  const drillInnerRef = useRef<HTMLDivElement>(null)
  // Holds the last drilled view while collapsing back to the menu so its content
  // doesn't blank mid-transition.
  const lastDrillRef = useRef<'following' | 'badges'>('following')

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
  // Apps the current user identity has recommended, matched the same way as the
  // following set. The recommend button treats these as recommended, and the
  // attest and revoke mutations keep the set fresh optimistically.
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
  // Selection is a display filter. Hydration caches every known authority
  // certificate, and only selected ones render as badges. Toggling an authority
  // in the manager updates this set and re-filters instantly, with no re-sync.
  const { data: selectedAuthorities = [] } = useSelectedCertificateAuthorities()
  const { data: certificateAuthorities = [] } = useCertificateAuthorities()
  const selectedResolvers = useMemo(
    () => new Set(selectedAuthorities.map((resolver) => resolver.toLowerCase())),
    [selectedAuthorities]
  )
  // Enabled authorities: the catalog filtered to the selected resolver set. Used
  // to render the stacked badge images on the menu's Badges row.
  const enabledCertificateAuthorities = useMemo(
    () => certificateAuthorities.filter((ca) => selectedResolvers.has(ca.resolver.toLowerCase())),
    [certificateAuthorities, selectedResolvers]
  )
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
        certificates: cached?.certificates ?? [],
        publishedAt: cached?.publishedAt ?? null
      })
    }
    for (const label of followingDisplay) addLabel(label)
    for (const label of bookmarkedApps) addLabel(label)
    // The recommend button is active when this identity recommended the app,
    // preserving any optimistic `hasUserAttested` from a just-submitted toggle.
    return [...byLabel.values()].map((app) => {
      // Show only badges from selected authorities. Hydration cached them all.
      const visible = app.certificates.filter((c) =>
        selectedResolvers.has(c.resolver.toLowerCase())
      )
      const scoped =
        visible.length === app.certificates.length ? app : { ...app, certificates: visible }
      return myRecommendations.has(scoped.label) && !scoped.hasUserAttested
        ? { ...scoped, hasUserAttested: true }
        : scoped
    })
  }, [allApps, followingDisplay, bookmarkedApps, labelDb, myRecommendations, selectedResolvers])
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
          certificates: [],
          publishedAt: null
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
      certificates: app.certificates,
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
  // Sharing copies a single browse link, e.g. `https://browse.paseo.li?app=calculator`.
  // Opened, it redirects the recipient straight into the app and arms a later
  // recommend prompt. No username is attached: reading it from the host is
  // permission-gated, and sharing must never trigger that prompt.
  const handleShare = useEvent(async (app: AppEntry) => {
    try {
      await navigator.clipboard.writeText(shareLink(app.label))
      showToast('Link copied')
    } catch {
      showToast('Could not copy to clipboard', true)
    }
  })
  // Yes closes the prompt and recommends. Prefer clicking the app's own upvote
  // button so it blinks and bubbles exactly as a direct click would. Fall back
  // to firing the recommend when that card is not currently rendered.
  const confirmRecommend = useEvent(() => {
    const prompt = recommendPrompt
    if (!prompt) return
    clearPendingRecommend(prompt.label)
    setRecommendPrompt(null)
    const upvote = rootRef.current?.querySelector(
      `[data-label="${prompt.label}"] .product-card__upvote`
    ) as HTMLElement | null
    if (upvote) {
      upvote.click()
      return
    }
    if (!signed) {
      showToast('Sign in to recommend')
      return
    }
    attestProduct.mutate(
      { label: prompt.label },
      {
        onSuccess: () => showToast('Recommended!'),
        onError: (err) => showToast(describeError(err))
      }
    )
  })
  // "Not now" clears the record so we don't nag again.
  const dismissRecommend = useEvent(() => {
    if (recommendPrompt) clearPendingRecommend(recommendPrompt.label)
    setRecommendPrompt(null)
  })
  // Completely re-establish the chain connection: drop the cached SDK (destroys
  // the papi client + chain socket) so the next query rebuilds a fresh
  // connection, then refetch. Driven by the overscroll-at-bottom gesture. On
  // touch, hold the loading dots for a minimum window so the pull always reads
  // as feedback even if the reset resolves instantly.
  const refreshConnection = useEvent(() => {
    console.warn('debug network connection', JSON.stringify({ event: 'refreshConnection' }))
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
  // Open the popover, anchoring it right-aligned under the ⋮ by measuring the
  // trigger. `next` lets the empty-state button expand straight into Following.
  const openMenu = (next: 'menu' | 'following' = 'menu') => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setAnchor({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
    setView(next)
    setMenuOpen(true)
  }

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
      certificates: resolvedApp.certificates,
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
      console.warn(
        'debug network connection',
        JSON.stringify({ event: 'accountConnectionStatus', status })
      )
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
  // Surface a deferred recommend prompt for an app the user was sent to from a
  // share link, once they return to browse. Skip and clear any the user has
  // already recommended. Re-checked on focus/visibility because inside the host
  // browse can stay mounted in the background across the app visit.
  useEffect(() => {
    const checkPending = () => {
      for (const entry of readPendingRecommends()) {
        if (myRecommendations.has(entry.label)) clearPendingRecommend(entry.label)
      }
      const next = readPendingRecommends().find((entry) => !myRecommendations.has(entry.label))
      if (next) setRecommendPrompt((prev) => prev ?? { label: next.label, from: next.from })
    }
    checkPending()
    window.addEventListener('focus', checkPending)
    document.addEventListener('visibilitychange', checkPending)
    return () => {
      window.removeEventListener('focus', checkPending)
      document.removeEventListener('visibilitychange', checkPending)
    }
  }, [myRecommendations])
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 500)
    return () => clearTimeout(id)
  }, [query])
  // Always reopen on the menu view.
  useEffect(() => {
    if (!menuOpen) setView('menu')
  }, [menuOpen])
  // Light-dismiss the popover on Escape, or any scroll or resize so it never
  // floats detached from the trigger. Scroll is captured so a scroll inside the
  // app list, not just the window, also closes it. Outside clicks close via the
  // transparent catcher rendered under the popover.
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    const onScroll = (e: Event) => {
      // Ignore scrolling inside the popover itself, and the scroll a focused
      // embedded input triggers as it settles. Only the page scrolling out from
      // under the trigger should close it.
      const target = e.target
      if (target instanceof Node && popoverRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [menuOpen])
  // Animate the popover height to the natural content height of the active view,
  // so it expands as a view drills in and collapses on the way back. A
  // ResizeObserver keeps it in step as the embedded managers load their data.
  useLayoutEffect(() => {
    if (!menuOpen) return
    const inner = view === 'menu' ? menuInnerRef.current : drillInnerRef.current
    if (!inner) return
    // offsetHeight, not getBoundingClientRect: the latter is scaled by the
    // popover entrance animation, which would measure the height ~8% short and
    // clip the bottom padding.
    const measure = () => setPopoverHeight(inner.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [menuOpen, view, following.length, enabledCertificateAuthorities.length])
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
      onClickCertificate={(certificate) => {
        setCertificateView({
          subjectName: app.name,
          subjectDomain: `${app.label}.dot`,
          certificate
        })
        setCertificateModalOpen(true)
      }}
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

  // The drill pane always renders one manager: the active drill view, or the last
  // one while collapsing back to the menu so it doesn't blank mid-transition.
  if (view !== 'menu') lastDrillRef.current = view
  const drill = view === 'menu' ? lastDrillRef.current : view

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
                <div class='tabs-row'>
                  <CategoryTabs
                    active={coldStart ? ['all'] : [currentMode]}
                    disabled={coldStart}
                    onSwitch={(mode) => {
                      setCurrentMode(mode)
                      setMenuOpen(false)
                    }}
                  />
                  <button
                    type='button'
                    ref={triggerRef}
                    class='customize-trigger'
                    aria-label='Customize'
                    aria-haspopup='menu'
                    aria-expanded={menuOpen}
                    onClick={() => openMenu()}
                  >
                    <MoreVertical size={20} />
                  </button>
                </div>
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
                    <button class='empty-state__btn' onClick={() => openMenu('following')}>
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

        <CertificateModal
          visible={certificateModalOpen}
          subjectName={certificateView?.subjectName ?? null}
          subjectDomain={certificateView?.subjectDomain ?? null}
          certificate={certificateView?.certificate ?? null}
          onDismiss={() => setCertificateModalOpen(false)}
        />

        {menuOpen && anchor && (
          <>
            <div class='customize-popover-catcher' onClick={() => setMenuOpen(false)} />
            <div
              ref={popoverRef}
              class='customize-popover'
              role='dialog'
              aria-label='Customize'
              style={{ top: anchor.top, right: anchor.right, height: popoverHeight }}
            >
              <div
                class={`customize-nav-track${view === 'menu' ? '' : ' customize-nav-track--drill'}`}
              >
                <div class='customize-pane' aria-hidden={view !== 'menu'}>
                  <div class='customize-pane__inner' ref={menuInnerRef}>
                    <button
                      type='button'
                      class='customize-nav-row'
                      onClick={() => setView('following')}
                    >
                      <span class='customize-nav-row__label'>Following</span>
                      <span class='customize-nav-row__count'>{following.length}</span>
                    </button>
                    <button
                      type='button'
                      class='customize-nav-row'
                      onClick={() => setView('badges')}
                    >
                      <span class='customize-nav-row__label'>Badges</span>
                      <span class='issuer-stack__marks'>
                        {enabledCertificateAuthorities.length === 0 ? (
                          <span class='issuer-stack__chip'>
                            <CertificateBadge cid={null} size={20} />
                          </span>
                        ) : (
                          <>
                            {enabledCertificateAuthorities.slice(0, MENU_BADGE_LIMIT).map((ca) => (
                              <span key={ca.resolver} class='issuer-stack__chip'>
                                <CertificateBadge cid={ca.badgeIconCid} size={20} />
                              </span>
                            ))}
                            {enabledCertificateAuthorities.length > MENU_BADGE_LIMIT && (
                              <span class='issuer-stack__chip issuer-stack__chip--more'>
                                +{enabledCertificateAuthorities.length - MENU_BADGE_LIMIT}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </button>
                  </div>
                </div>
                <div class='customize-pane' aria-hidden={view === 'menu'}>
                  <div
                    class='customize-pane__inner customize-pane__inner--drill'
                    ref={drillInnerRef}
                  >
                    <div class='customize-drill__header'>
                      <button
                        type='button'
                        class='customize-drill__icon'
                        aria-label='Back'
                        onClick={() => setView('menu')}
                      >
                        <ArrowLeft size={20} />
                      </button>
                      <span class='customize-drill__title'>
                        {drill === 'following' ? 'Following' : 'Badges'}
                      </span>
                      <button
                        type='button'
                        class='customize-drill__icon'
                        aria-label='Close'
                        onClick={() => setMenuOpen(false)}
                      >
                        <X size={20} />
                      </button>
                    </div>
                    {drill === 'following' ? (
                      <FollowingManager
                        embedded
                        visible={menuOpen && view === 'following'}
                        following={following}
                        onAdd={handleFollow}
                        onRemove={handleUnfollow}
                        onDismiss={() => setMenuOpen(false)}
                      />
                    ) : (
                      <CertificateAuthorityManager embedded />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        <RecommendPrompt
          visible={!!recommendPrompt}
          label={recommendPrompt?.label ?? ''}
          onConfirm={confirmRecommend}
          onDismiss={dismissRecommend}
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
