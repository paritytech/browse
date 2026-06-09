/**
 * React Query bindings for the apps subsystem.
 *
 */

import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query'

import { readContentByName } from './remote'
import { materialize, syncAllApps } from './sync'
import type { AppEntry } from './types'
import { readBookmarks } from '../../db/bookmarks'
import { type LabelEntry, readLabels } from '../../db/labels'
import { ensureBrowseSdk } from '../../lib/client'

const ALL_APPS_KEY = ['apps', 'all'] as const
const LABELS_KEY = ['labels', 'db'] as const

/** Subscribe to the full labels DB as a Map. */
export function useLabelsStorage() {
  return useQuery<Map<string, LabelEntry>>({
    queryKey: LABELS_KEY,
    queryFn: async () => new Map((await readLabels()).map((entry) => [entry.label, entry])),
    staleTime: Infinity
  })
}

export { LABELS_KEY }

/** Read the labels blob from the host bridge once per session and materialise it. */
let initialDiskLoad: Promise<AppEntry[]> | null = null

function loadInitialApps(): Promise<AppEntry[]> {
  if (!initialDiskLoad) {
    initialDiskLoad = readLabels().then((entries) =>
      materialize(new Map(entries.map((entry) => [entry.label, entry])))
    )
  }
  return initialDiskLoad
}

export function getAllAppsOptions(queryClient: QueryClient) {
  const pendingLabels = (): Set<string> => {
    const labels = new Set<string>()
    for (const mutation of queryClient.getMutationCache().findAll({ status: 'pending' })) {
      const variables = mutation.state.variables
      if (typeof variables === 'string') labels.add(variables)
    }
    return labels
  }
  const merge = (prev: AppEntry[] | undefined, fresh: AppEntry[]): AppEntry[] => {
    const pending = pendingLabels()
    if (!prev || pending.size === 0) return fresh
    const prevByLabel = new Map(prev.map((app) => [app.label, app]))
    return fresh.map((next) =>
      pending.has(next.label) ? (prevByLabel.get(next.label) ?? next) : next
    )
  }
  return queryOptions<AppEntry[]>({
    queryKey: ALL_APPS_KEY,
    queryFn: async () => {
      // Probe network reachability up front
      await ensureBrowseSdk()
      const cachedLabels = await readLabels()
      // Bookmarked labels are kept through the sync prune even when unpublished,
      // so their cached name/icon survives for the Bookmarks tab.
      const protectedLabels = new Set(await readBookmarks())
      const finalApps = await syncAllApps(
        cachedLabels,
        (progressApps) => {
          queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, (prev) => merge(prev, progressApps))
        },
        protectedLabels
      )
      // Sync has rewritten the labels DB.
      await queryClient.invalidateQueries({ queryKey: LABELS_KEY })
      return merge(queryClient.getQueryData<AppEntry[]>(ALL_APPS_KEY), finalApps)
    },
    staleTime: 5 * 60_000,
    retry: false
  })
}

export function useGetAllApps(queryClient: QueryClient) {
  return useQuery(getAllAppsOptions(queryClient))
}

export async function prefetchAllApps(queryClient: QueryClient) {
  const cached = await loadInitialApps()
  if (cached.length > 0) {
    // updatedAt: 0 marks the cached data as stale so useQuery will trigger a
    // background refetch (the actual network sync) when a subscriber mounts.
    queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, cached, { updatedAt: 0 })
  }
}

/**
 * Resolve a single `.dot` label to an {@link AppEntry}, hitting the disk
 * cache first and falling back to the content resolver.
 */
async function resolveLabel(name: string): Promise<AppEntry | null> {
  const cachedLabels = await readLabels()
  const cached = cachedLabels.find((entry) => entry.label === name)
  if (cached?.contentHash) {
    return {
      label: cached.label,
      name: cached.name,
      description: cached.description,
      iconCid: cached.iconCid,
      contentHash: cached.contentHash,
      isLive: true,
      attestationCount: cached.attestationCount,
      hasUserAttested: cached.hasUserAttested,
      isCompliant: cached.isCompliant ?? false
    }
  }

  const content = await readContentByName(name)
  if (!content) return null

  return {
    label: name,
    name: content.name,
    description: content.description,
    iconCid: content.iconCid,
    contentHash: content.contentHash,
    isLive: true,
    attestationCount: null,
    hasUserAttested: false,
    isCompliant: false
  }
}
const LABEL_RESOLVE_TIMEOUT_MS = 5_000 // 5s

export function useResolveLabel(label: string, enabled: boolean) {
  return useQuery<AppEntry | null>({
    queryKey: ['resolveLabel', label],
    queryFn: () =>
      Promise.race([
        resolveLabel(label),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), LABEL_RESOLVE_TIMEOUT_MS))
      ]),
    enabled: enabled && label.length > 0,
    staleTime: 60_000
  })
}
