/**
 * React Query bindings for the apps subsystem.
 *
 * Two queries: `apps:pcf` (curated, hosted-only) and `apps:all` (Publisher-
 * driven, delegates to {@link syncAllApps}). Plus {@link useResolveLabel} for
 * the search bar. No chain reads happen here; discovery lives in `./sync`,
 * primitive reads in `./remote`.
 */

import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query'

import { readContentByName } from './remote'
import { materialize, syncAllApps } from './sync'
import type { AppEntry } from './types'
import { readAllLabels } from '../../db/labels'
import { getCachedPcf, setCachedPcf } from '../../lib/cache'
import { isHosted } from '../../lib/local-storage'

const PCF_PRODUCTS: ReadonlyArray<{ label: string; name: string; description: string }> = [
  { label: 'coinflipgame03', name: 'Coin Flip', description: 'A simple coin flip app.' },
  { label: 'crosswords', name: 'Mini Crossword', description: 'A quick 5x5 crossword puzzle.' },
  { label: 'ohnotes', name: 'Notes', description: 'Notes that follow you everywhere.' }
]

async function fetchPcfApps(): Promise<AppEntry[]> {
  return PCF_PRODUCTS.map((p) => ({
    label: p.label,
    name: p.name,
    description: p.description,
    contentHash: null,
    isLive: true,
    attestationCount: null,
    hasUserAttested: false,
    source: 'pcf' as const
  }))
}

const PCF_APPS_KEY = ['apps', 'pcf'] as const

function getPcfAppsOptions() {
  return queryOptions<AppEntry[]>({
    queryKey: PCF_APPS_KEY,
    queryFn: async () => {
      if (!isHosted()) return []
      const apps = await fetchPcfApps()
      setCachedPcf(apps)
      return apps
    },
    staleTime: 5 * 60_000
  })
}

export function useGetPcfApps() {
  return useQuery(getPcfAppsOptions())
}

export async function prefetchPcfApps(queryClient: QueryClient) {
  const cached = await getCachedPcf()
  if (cached.length > 0) {
    // updatedAt: 0 marks the cached data as stale so useQuery will trigger a
    // background refetch (the actual chain sync) when a subscriber mounts.
    queryClient.setQueryData<AppEntry[]>(PCF_APPS_KEY, cached, { updatedAt: 0 })
  }
}

const ALL_APPS_KEY = ['apps', 'all'] as const

/** Read the labels blob from the host bridge once per session and materialise it. */
let initialDiskLoad: Promise<AppEntry[]> | null = null

function loadInitialApps(): Promise<AppEntry[]> {
  if (!initialDiskLoad) {
    initialDiskLoad = readAllLabels().then((entries) =>
      materialize(new Map(entries.map((l) => [l.label, l])))
    )
  }
  return initialDiskLoad
}

export function getAllAppsOptions(queryClient: QueryClient) {
  const pendingLabels = (): Set<string> => {
    const labels = new Set<string>()
    for (const m of queryClient.getMutationCache().findAll({ status: 'pending' })) {
      const v = m.state.variables
      if (typeof v === 'string') labels.add(v)
    }
    return labels
  }
  const merge = (prev: AppEntry[] | undefined, fresh: AppEntry[]): AppEntry[] => {
    const pending = pendingLabels()
    if (!prev || pending.size === 0) return fresh
    const prevByLabel = new Map(prev.map((a) => [a.label, a]))
    return fresh.map((next) =>
      pending.has(next.label) ? (prevByLabel.get(next.label) ?? next) : next
    )
  }
  return queryOptions<AppEntry[]>({
    queryKey: ALL_APPS_KEY,
    queryFn: async () => {
      const cachedLabels = await readAllLabels()
      const finalApps = await syncAllApps(cachedLabels, (progressApps) => {
        queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, (prev) => merge(prev, progressApps))
      })
      return merge(queryClient.getQueryData<AppEntry[]>(ALL_APPS_KEY), finalApps)
    },
    staleTime: 5 * 60_000
  })
}

export function useGetAllApps(queryClient: QueryClient) {
  return useQuery(getAllAppsOptions(queryClient))
}

export async function prefetchAllApps(queryClient: QueryClient) {
  const cached = await loadInitialApps()
  if (cached.length > 0) {
    // updatedAt: 0 marks the cached data as stale so useQuery will trigger a
    // background refetch (the actual chain sync) when a subscriber mounts.
    queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, cached, { updatedAt: 0 })
  }
}

/**
 * Resolve a single `.dot` label to an {@link AppEntry}, hitting the disk
 * cache first and falling back to the content resolver.
 */
async function resolveLabel(name: string): Promise<AppEntry | null> {
  const cachedLabels = await readAllLabels()
  const cached = cachedLabels.find((l) => l.label === name)
  if (cached?.contentHash) {
    return {
      label: cached.label,
      name: cached.name,
      description: cached.description,
      contentHash: cached.contentHash,
      isLive: true,
      attestationCount: cached.attestationCount,
      hasUserAttested: cached.hasUserAttested,
      source: 'all'
    }
  }

  const content = await readContentByName(name)
  if (!content) return null

  return {
    label: name,
    name: content.name,
    description: content.description,
    contentHash: content.contentHash,
    isLive: true,
    attestationCount: null,
    hasUserAttested: false,
    source: 'all'
  }
}

export function useResolveLabel(label: string, enabled: boolean) {
  return useQuery<AppEntry | null>({
    queryKey: ['resolveLabel', label],
    queryFn: () => resolveLabel(label),
    enabled: enabled && label.length > 0,
    staleTime: 60_000
  })
}
