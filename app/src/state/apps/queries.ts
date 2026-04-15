import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query'

import { getCachedAll, setCachedAll } from './cache'
import { type AppEntry } from './types'
import {
  decodeAddress,
  decodeAddressArray,
  decodeBytes,
  decodeIpfsContenthash,
  decodeString,
  decodeStringArray,
  decodeUint64,
  encodeAttestCount,
  encodeContenthash,
  encodeGetAllDeployedStores,
  encodeGetValues,
  encodeOwner,
  encodeText,
  type MulticallTarget,
  namehash,
  nodeToSubject
} from '../../lib/abi'
import { getCachedPcf, setCachedPcf } from '../../lib/cache'
import { lookupOriginalAccount, reviveCall } from '../../lib/client'
import { CONTRACTS } from '../../lib/config'
import { dlog } from '../../lib/debug'
import { isHosted } from '../../lib/local-storage'
import { multicall } from '../../lib/multicall'
import { fetchStoreProducts } from '../../lib/store'

async function fetchPcfApps(): Promise<AppEntry[]> {
  const t0 = performance.now()
  dlog('PCF: Store.getProducts()')
  const storeProducts = await fetchStoreProducts()
  dlog(
    `PCF: ${storeProducts.length} products from Store (total ${(performance.now() - t0).toFixed(0)}ms)`
  )

  if (storeProducts.length === 0) return []

  return storeProducts.map((p) => ({
    label: p.label,
    name: p.name || null,
    description: p.description || 'No description',
    contentHash: null,
    isLive: true,
    vouchCount: null,
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
    queryClient.setQueryData<AppEntry[]>(PCF_APPS_KEY, cached)
  }
}

export type GetAppsResult =
  | { status: 'ok'; apps: AppEntry[] }
  | { status: 'error'; message: string }

export type OnAllProgress = (apps: AppEntry[]) => void

async function fetchAllApps(onProgress?: OnAllProgress): Promise<AppEntry[]> {
  dlog('All: StoreFactory.getAllDeployedStores()')
  const storesData = await reviveCall(CONTRACTS.STORE_FACTORY, encodeGetAllDeployedStores())
  const storeAddresses = decodeAddressArray(storesData)
  dlog(`Found ${storeAddresses.length} stores`)
  if (storeAddresses.length === 0) return []

  const CONCURRENCY = 1
  const BATCH_SIZE = 50
  const t0 = performance.now()

  dlog(`All: Batch owner() for ${storeAddresses.length} stores`)
  const ownerCalls: MulticallTarget[] = storeAddresses.map((addr) => ({
    target: addr as `0x${string}`,
    callData: encodeOwner()
  }))
  const ownerResults = await multicall(ownerCalls)
  dlog(`All: owner() done (${(performance.now() - t0).toFixed(0)}ms)`)

  const t1 = performance.now()
  dlog(`All: Reverse lookup owners (concurrency=${CONCURRENCY})`)
  const storeOwners: (string | null)[] = new Array(storeAddresses.length).fill(null)
  let lookupNext = 0
  async function lookupWorker(): Promise<void> {
    while (lookupNext < storeAddresses.length) {
      const i = lookupNext++
      if (!ownerResults[i]?.success) continue
      try {
        const ownerH160 = decodeAddress(ownerResults[i].returnData)
        storeOwners[i] = await lookupOriginalAccount(ownerH160)
      } catch {
        // skip failed decode
      }
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  }
  const lookupWorkers: Promise<void>[] = []
  for (let i = 0; i < Math.min(CONCURRENCY, storeAddresses.length); i++)
    lookupWorkers.push(lookupWorker())
  await Promise.all(lookupWorkers)

  const mappedCount = storeOwners.filter(Boolean).length
  dlog(`All: ${mappedCount} mapped owners (${(performance.now() - t1).toFixed(0)}ms)`)

  const t2 = performance.now()
  dlog(`All: Scanning stores for labels (concurrency=${CONCURRENCY})`)
  const allApps: AppEntry[] = []
  const seenLabels = new Set<string>()
  let pendingLabels: string[] = []

  async function flushBatch(labels: string[]): Promise<void> {
    if (labels.length === 0) return

    const chCalls: MulticallTarget[] = labels.map((label) => ({
      target: CONTRACTS.CONTENT_RESOLVER,
      callData: encodeContenthash(namehash(`${label}.dot`))
    }))
    const chResults = await multicall(chCalls)
    await new Promise<void>((r) => setTimeout(r, 0))

    const liveLabels: { label: string; contentHash: string }[] = []
    for (let i = 0; i < labels.length; i++) {
      if (!chResults[i]?.success) continue
      try {
        const decoded = decodeBytes(chResults[i].returnData)
        const cid = decodeIpfsContenthash(decoded)
        if (cid) liveLabels.push({ label: labels[i], contentHash: cid })
      } catch {
        // skip failed decode
      }
    }

    if (liveLabels.length === 0) return

    const CALLS_PER = 3
    const metaCalls: MulticallTarget[] = []
    for (const { label } of liveLabels) {
      const node = namehash(`${label}.dot`)
      const subject = nodeToSubject(node)
      metaCalls.push(
        { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, 'name') },
        { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, 'description') },
        { target: CONTRACTS.ATTESTATION_REGISTRY, callData: encodeAttestCount(subject) }
      )
    }
    const metaResults = await multicall(metaCalls)
    await new Promise<void>((r) => setTimeout(r, 0))

    const batch: AppEntry[] = []
    for (let i = 0; i < liveLabels.length; i++) {
      const { label, contentHash } = liveLabels[i]
      const base = i * CALLS_PER

      let name: string | null = null
      if (metaResults[base]?.success) {
        try {
          const n = decodeString(metaResults[base].returnData)
          if (n) name = n
        } catch {
          // skip failed decode
        }
      }

      let description = ''
      if (metaResults[base + 1]?.success) {
        try {
          description = decodeString(metaResults[base + 1].returnData)
        } catch {
          // skip failed decode
        }
      }

      let vouchCount: number | null = null
      if (metaResults[base + 2]?.success) {
        try {
          const d = decodeUint64(metaResults[base + 2].returnData)
          if (d !== null) vouchCount = d
        } catch {
          // skip failed decode
        }
      }

      batch.push({
        label,
        name,
        description: description || 'No description',
        contentHash,
        isLive: true,
        vouchCount,
        source: 'all' as const
      })
    }

    if (batch.length > 0) {
      allApps.push(...batch)
      dlog(`  batch(${labels.length}): +${batch.length} live (${allApps.length} total)`)
      onProgress?.([...allApps])
    }
  }

  let flushPromise: Promise<void> = Promise.resolve()

  function scheduleFlush(labels: string[]): void {
    const toFlush = labels.slice()
    flushPromise = flushPromise.then(() => flushBatch(toFlush))
  }

  async function scanStore(s: number): Promise<void> {
    const ownerSS58 = storeOwners[s]
    if (!ownerSS58) return

    try {
      const raw = await reviveCall(storeAddresses[s] as `0x${string}`, encodeGetValues(), ownerSS58)
      const storeLabels = decodeStringArray(raw)
      for (const l of storeLabels) {
        if (!l) continue
        const normalized = l.endsWith('.dot') ? l.slice(0, -4) : l
        if (normalized.includes('.')) continue
        if (seenLabels.has(normalized)) continue
        seenLabels.add(normalized)
        pendingLabels.push(normalized)
      }

      if (pendingLabels.length >= BATCH_SIZE) {
        const batch = pendingLabels
        pendingLabels = []
        scheduleFlush(batch)
      }
    } catch {
      dlog(`  store[${s}]: failed`, 'warn')
    }

    await new Promise<void>((r) => setTimeout(r, 0))
  }

  let next = 0
  async function worker(): Promise<void> {
    while (next < storeAddresses.length) {
      const s = next++
      await scanStore(s)
    }
  }
  const workers: Promise<void>[] = []
  for (let i = 0; i < Math.min(CONCURRENCY, storeAddresses.length); i++) workers.push(worker())
  await Promise.all(workers)

  if (pendingLabels.length > 0) {
    scheduleFlush(pendingLabels)
    pendingLabels = []
  }
  await flushPromise

  dlog(`All: Scan done (${(performance.now() - t2).toFixed(0)}ms)`)
  dlog(
    `All: Done — ${allApps.length} live apps from ${seenLabels.size} labels (total ${(performance.now() - t0).toFixed(0)}ms)`
  )
  return allApps
}

export async function getAllApps(onProgress?: OnAllProgress): Promise<GetAppsResult> {
  const hosted = isHosted()
  if (!hosted) {
    return { status: 'ok', apps: [] }
  }
  try {
    const apps = await fetchAllApps(onProgress)
    return { status: 'ok', apps }
  } catch (err) {
    dlog(`All fetch failed: ${err}`, 'error')
    return { status: 'error', message: String(err) }
  }
}

const ALL_APPS_KEY = ['apps', 'all'] as const

export function getAllAppsOptions(queryClient: QueryClient) {
  return queryOptions<AppEntry[]>({
    queryKey: ALL_APPS_KEY,
    queryFn: async () => {
      const result = await getAllApps((progressApps) => {
        queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, progressApps)
        setCachedAll(progressApps)
      })
      if (result.status === 'ok') {
        setCachedAll(result.apps)
        return result.apps
      }
      throw new Error(result.message)
    },
    staleTime: 5 * 60_000
  })
}

export function useGetAllApps(queryClient: QueryClient) {
  return useQuery(getAllAppsOptions(queryClient))
}

export async function prefetchAllApps(queryClient: QueryClient) {
  const cached = await getCachedAll()
  if (cached.length > 0) {
    queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, cached)
  }
}
