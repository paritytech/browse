import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query'

import { type AppEntry } from './types'
import {
  decodeAddress,
  decodeAddressArray,
  decodeBytes,
  decodeIpfsContenthash,
  decodeString,
  decodeStringArray,
  decodeUint64,
  encodeContenthash,
  encodeCountByRecipientAndSchema,
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
import { CONTRACTS, SCHEMA_LIKE_ID } from '../../lib/config'
import { dlog } from '../../lib/debug'
import { isHosted } from '../../lib/local-storage'
import { multicall } from '../../lib/multicall'
import { fetchStoreProducts } from '../../lib/store'
import {
  type LabelCacheEntry,
  readAllLabels,
  readAllStores,
  readSS58Address,
  removeStore,
  type StoreCacheEntry,
  updateLabelsInBulk,
  updateMeta,
  updateSS58Address,
  updateStoresInBulk
} from '../db'

const BATCH_SIZE = 50

function tryDecode<T>(
  r: { success: boolean; returnData: `0x${string}` } | undefined,
  fn: (d: `0x${string}`) => T | null
): T | null {
  if (!r?.success) return null
  try {
    return fn(r.returnData)
  } catch {
    return null
  }
}

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
    queryClient.setQueryData<AppEntry[]>(PCF_APPS_KEY, cached)
  }
}

function labelToApp(l: LabelCacheEntry): AppEntry {
  return {
    label: l.label,
    name: l.name,
    description: l.description,
    contentHash: l.contentHash,
    isLive: l.contentHash !== null,
    attestationCount: l.attestationCount,
    hasUserAttested: false,
    source: 'all' as const
  }
}

function materialize(
  stores: StoreCacheEntry[],
  labelMetadata: Map<string, LabelCacheEntry>
): AppEntry[] {
  const visitedLabels = new Set<string>()
  const apps: AppEntry[] = []
  for (const store of stores) {
    for (const label of store.labels) {
      if (visitedLabels.has(label)) continue
      visitedLabels.add(label)
      const metadata = labelMetadata.get(label)
      if (!metadata?.contentHash) continue
      apps.push(labelToApp(metadata))
    }
  }
  return apps
}

async function cachedLookupSS58Address(h160Address: string): Promise<string | null> {
  const normalizedH160Address = h160Address.toLowerCase()
  const cachedSS58Address = await readSS58Address(normalizedH160Address)
  if (cachedSS58Address) return cachedSS58Address
  const resolvedSS58Address = await lookupOriginalAccount(normalizedH160Address)
  if (resolvedSS58Address) await updateSS58Address(normalizedH160Address, resolvedSS58Address)
  return resolvedSS58Address
}

async function flushLabelBatch(
  stores: Map<string, StoreCacheEntry>,
  labels: Map<string, LabelCacheEntry>,
  batch: string[],
  onProgress?: (apps: AppEntry[]) => void
): Promise<void> {
  if (batch.length === 0) return

  const chCalls: MulticallTarget[] = batch.map((label) => ({
    target: CONTRACTS.CONTENT_RESOLVER,
    callData: encodeContenthash(namehash(`${label}.dot`))
  }))
  const chResults = await multicall(chCalls)

  const liveLabels: { label: string; contentHash: string }[] = []
  for (let i = 0; i < batch.length; i++) {
    const cid = tryDecode(chResults[i], (d) => decodeIpfsContenthash(decodeBytes(d)))
    if (cid) liveLabels.push({ label: batch[i], contentHash: cid })
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
      {
        target: CONTRACTS.ATTESTATION_SERVICE,
        callData: encodeCountByRecipientAndSchema(subject, SCHEMA_LIKE_ID)
      }
    )
  }
  const metaResults = await multicall(metaCalls)

  const toPersist: LabelCacheEntry[] = liveLabels.map(({ label, contentHash }, i) => {
    const base = i * CALLS_PER
    const name = tryDecode(metaResults[base], decodeString) || null
    const description = tryDecode(metaResults[base + 1], decodeString) || ''
    const entry: LabelCacheEntry = {
      label,
      name,
      description: description || 'No description',
      contentHash,
      attestationCount: tryDecode(metaResults[base + 2], decodeUint64)
    }
    labels.set(label, entry)
    return entry
  })

  await updateLabelsInBulk(toPersist)
  onProgress?.(materialize([...stores.values()], labels))
}

async function scanStores(
  addresses: string[],
  stores: Map<string, StoreCacheEntry>,
  labels: Map<string, LabelCacheEntry>,
  onProgress?: (apps: AppEntry[]) => void
): Promise<void> {
  if (addresses.length === 0) return

  const ownerCalls: MulticallTarget[] = addresses.map((addr) => ({
    target: addr as `0x${string}`,
    callData: encodeOwner()
  }))
  const ownerResults = await multicall(ownerCalls)

  const ownerH160Addresses: (string | null)[] = ownerResults.map((r) =>
    tryDecode(r, (d) => decodeAddress(d).toLowerCase())
  )

  const ownerSS58Addresses: (string | null)[] = []
  for (const h160Address of ownerH160Addresses) {
    ownerSS58Addresses.push(h160Address ? await cachedLookupSS58Address(h160Address) : null)
  }

  const seenLabels = new Set<string>(labels.keys())
  let pending: string[] = []
  const newStoreEntries: StoreCacheEntry[] = []

  for (let i = 0; i < addresses.length; i++) {
    const storeAddress = addresses[i]
    const ownerH160Address = ownerH160Addresses[i]
    const ownerSS58Address = ownerSS58Addresses[i]

    if (!ownerSS58Address) {
      const entry: StoreCacheEntry = {
        storeAddress,
        ownerH160Address,
        ownerSS58Address: null,
        labels: []
      }
      stores.set(storeAddress, entry)
      newStoreEntries.push(entry)
      continue
    }

    let storeLabels: string[] = []
    try {
      const raw = await reviveCall(
        storeAddress as `0x${string}`,
        encodeGetValues(),
        ownerSS58Address
      )
      storeLabels = decodeStringArray(raw)
    } catch {
      // skip failed store
    }

    const normalized: string[] = []
    for (const l of storeLabels) {
      if (!l) continue
      const n = l.endsWith('.dot') ? l.slice(0, -4) : l
      if (n.includes('.')) continue
      normalized.push(n)
      if (!seenLabels.has(n)) {
        seenLabels.add(n)
        pending.push(n)
      }
    }

    const entry: StoreCacheEntry = {
      storeAddress,
      ownerH160Address,
      ownerSS58Address,
      labels: normalized
    }
    stores.set(storeAddress, entry)
    newStoreEntries.push(entry)
    if (pending.length >= BATCH_SIZE) {
      await flushLabelBatch(stores, labels, pending, onProgress)
      await updateStoresInBulk(newStoreEntries)
      pending = []
    }
  }

  if (pending.length > 0) {
    await flushLabelBatch(stores, labels, pending, onProgress)
  }

  await updateStoresInBulk(newStoreEntries)
}

async function syncAllApps(
  cachedStores: StoreCacheEntry[],
  cachedLabels: LabelCacheEntry[],
  onProgress?: (apps: AppEntry[]) => void
): Promise<AppEntry[]> {
  const stores = new Map(cachedStores.map((s) => [s.storeAddress, s]))
  const labels = new Map(cachedLabels.map((l) => [l.label, l]))

  let current: string[]
  try {
    const raw = await reviveCall(CONTRACTS.STORE_FACTORY, encodeGetAllDeployedStores())
    current = decodeAddressArray(raw).map((a) => a.toLowerCase())
  } catch {
    return materialize([...stores.values()], labels)
  }

  // Remove stores that no longer exist
  const currentSet = new Set(current)
  const toDelete: string[] = []
  for (const addr of stores.keys()) {
    if (!currentSet.has(addr)) toDelete.push(addr)
  }
  await Promise.all(
    toDelete.map(async (addr) => {
      await removeStore(addr)
      stores.delete(addr)
    })
  )

  // Only scan stores not yet cached
  const toScan = current.filter((addr) => !stores.has(addr))

  if (toScan.length > 0) {
    await scanStores(toScan, stores, labels, onProgress)
  }

  await updateMeta({ knownStoreAddresses: current })

  return materialize([...stores.values()], labels)
}

const ALL_APPS_KEY = ['apps', 'all'] as const

export function getAllAppsOptions(queryClient: QueryClient) {
  return queryOptions<AppEntry[]>({
    queryKey: ALL_APPS_KEY,
    queryFn: async () => {
      const [cachedStores, cachedLabels] = await Promise.all([readAllStores(), readAllLabels()])
      return syncAllApps(cachedStores, cachedLabels, (progressApps) => {
        queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, progressApps)
      })
    },
    staleTime: 5 * 60_000
  })
}

export function useGetAllApps(queryClient: QueryClient) {
  return useQuery(getAllAppsOptions(queryClient))
}

export async function prefetchAllApps(queryClient: QueryClient) {
  const [stores, labelEntries] = await Promise.all([readAllStores(), readAllLabels()])
  const labels = new Map(labelEntries.map((l) => [l.label, l]))
  const cached = materialize(stores, labels)
  if (cached.length > 0) {
    queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, cached)
  }
}
