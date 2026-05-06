import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query'
import { AccountId, type SS58String } from 'polkadot-api'

import { type AppEntry } from './types'
import { readSS58Address, updateSS58Address } from '../../db/addresses'
import { type LabelEntry, readAllLabels, updateLabels } from '../../db/labels'
import { readAllStores, removeStores, type StoreEntry, updateStores } from '../../db/stores'
import {
  decodeAddress,
  decodeAddressArray,
  decodeBool,
  decodeBytes,
  decodeIpfsContenthash,
  decodeString,
  decodeStringArray,
  decodeUint64,
  encodeContenthash,
  encodeCountByRecipientAndSchema,
  encodeGetAllDeployedStores,
  encodeGetValues,
  encodeIsActiveAny,
  encodeOwner,
  encodeText,
  type MulticallTarget,
  namehash,
  nodeToSubject
} from '../../lib/abi'
import { attestationService } from '../../lib/attestation-service'
import { getCachedPcf, setCachedPcf } from '../../lib/cache'
import { lookupOriginalAccount, reviveCall } from '../../lib/client'
import { CONTRACTS, SCHEMA_LIKE_ID } from '../../lib/config'
import { hiddenLog } from '../../lib/debug'
import { isHosted } from '../../lib/local-storage'
import { multicall } from '../../lib/multicall'
import { fetchStoreProducts } from '../../lib/store'

const BATCH_SIZE = 200
const METADATA_TTL_MS = 24 * 60 * 60 * 1000

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
  const storeProducts = await fetchStoreProducts()
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
    // updatedAt: 0 marks the cached data as stale so useQuery will trigger a
    // background refetch (the actual chain sync) when a subscriber mounts.
    queryClient.setQueryData<AppEntry[]>(PCF_APPS_KEY, cached, { updatedAt: 0 })
  }
}

function labelToApp(l: LabelEntry): AppEntry {
  return {
    label: l.label,
    name: l.name,
    description: l.description,
    contentHash: l.contentHash,
    isLive: l.contentHash !== null,
    attestationCount: l.attestationCount,
    hasUserAttested: l.hasUserAttested,
    source: 'all' as const
  }
}

function materialize(stores: StoreEntry[], labelMetadata: Map<string, LabelEntry>): AppEntry[] {
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

// Process labels one aggregate3 chunk at a time:
//   1. contenthash×CHUNK  → persist live entries (label as display name) → UI flush
//   2. text(name)×live    → persist real names → UI flush
// Between each RPC the rate gate enforces spacing so we never overrun the host limiter.
const FLUSH_CHUNK_SIZE = 30

async function flushLabelBatch(
  stores: Map<string, StoreEntry>,
  labels: Map<string, LabelEntry>,
  batch: string[],
  userH160: `0x${string}` | null,
  onProgress?: (apps: AppEntry[]) => void
): Promise<void> {
  for (let i = 0; i < batch.length; i += FLUSH_CHUNK_SIZE) {
    const chunk = batch.slice(i, i + FLUSH_CHUNK_SIZE)

    const chCalls: MulticallTarget[] = chunk.map((label) => ({
      target: CONTRACTS.CONTENT_RESOLVER,
      callData: encodeContenthash(namehash(`${label}.dot`))
    }))
    hiddenLog(
      `Fetching content hashes: multicall(${CONTRACTS.MULTICALL3}, [contenthash×${chunk.length}])`
    )
    const chResults = await multicall(chCalls)

    // Build entries for ALL labels in this chunk — live (with contenthash) and non-live (null).
    // Persisting non-live entries too lets a future rescan know they were already checked.
    const chunkEntries: LabelEntry[] = []
    const liveInChunk: { label: string; contentHash: string }[] = []
    for (let j = 0; j < chunk.length; j++) {
      const cid = tryDecode(chResults[j], (d) => decodeIpfsContenthash(decodeBytes(d)))
      const entry: LabelEntry = {
        label: chunk[j],
        name: null,
        description: 'No description',
        contentHash: cid,
        attestationCount: null,
        hasUserAttested: false,
        fetchedAt: Date.now()
      }
      labels.set(chunk[j], entry)
      chunkEntries.push(entry)
      if (cid) liveInChunk.push({ label: chunk[j], contentHash: cid })
    }
    await updateLabels(chunkEntries)
    onProgress?.(materialize([...stores.values()], labels))

    if (liveInChunk.length === 0) continue

    // Fetch name + description + attestation count (+ optionally isActiveAny for
    // the signed-in user) for live labels in a single multicall.
    const callsPerLive = userH160 ? 4 : 3
    const metaCalls: MulticallTarget[] = []
    for (const { label } of liveInChunk) {
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
      if (userH160) {
        metaCalls.push({
          target: CONTRACTS.ATTESTATION_SERVICE,
          callData: encodeIsActiveAny(subject, SCHEMA_LIKE_ID, [userH160])
        })
      }
    }
    hiddenLog(
      `Fetching metadata for ${liveInChunk.length} live labels: multicall(${CONTRACTS.MULTICALL3}, [${metaCalls.length} calls])`
    )
    const metaResults = await multicall(metaCalls)

    const namedEntries: LabelEntry[] = liveInChunk.map(({ label, contentHash }, idx) => {
      const base = idx * callsPerLive
      const name = tryDecode(metaResults[base], decodeString) || null
      const description = tryDecode(metaResults[base + 1], decodeString) || ''
      const attestationCount = tryDecode(metaResults[base + 2], decodeUint64)
      const hasUserAttested = userH160
        ? (tryDecode(metaResults[base + 3], decodeBool) ?? false)
        : false
      const entry: LabelEntry = {
        label,
        name,
        description: description || 'No description',
        contentHash,
        attestationCount,
        hasUserAttested,
        fetchedAt: Date.now()
      }
      labels.set(label, entry)
      return entry
    })
    await updateLabels(namedEntries)
    onProgress?.(materialize([...stores.values()], labels))
  }
}

async function scanStores(
  addresses: string[],
  stores: Map<string, StoreEntry>,
  labels: Map<string, LabelEntry>,
  userH160: `0x${string}` | null,
  onProgress?: (apps: AppEntry[]) => void
): Promise<void> {
  if (addresses.length === 0) return

  const ownerCalls: MulticallTarget[] = addresses.map((addr) => ({
    target: addr as `0x${string}`,
    callData: encodeOwner()
  }))
  const ownersT0 = performance.now()
  hiddenLog(`Fetching owners: multicall(${CONTRACTS.MULTICALL3}, [owner×${addresses.length}])`)
  const ownerResults = await multicall(ownerCalls)
  hiddenLog(
    `Received ${ownerResults.length} owners (${(performance.now() - ownersT0).toFixed(0)}ms)`
  )

  const ownerH160Addresses: (string | null)[] = ownerResults.map((r) =>
    tryDecode(r, (d) => decodeAddress(d).toLowerCase())
  )

  const seenLabels = new Set<string>(labels.keys())
  let pending: string[] = []
  const newStoreEntries: StoreEntry[] = []

  for (let i = 0; i < addresses.length; i++) {
    const storeAddress = addresses[i]
    const ownerH160Address = ownerH160Addresses[i]
    const ownerSS58Address = ownerH160Address
      ? await cachedLookupSS58Address(ownerH160Address)
      : null

    if (!ownerSS58Address) {
      const entry: StoreEntry = {
        storeAddress,
        ownerH160Address,
        ownerSS58Address: null,
        labels: []
      }
      stores.set(storeAddress, entry)
      newStoreEntries.push(entry)
      continue
    }

    let storeLabels: string[]
    try {
      const raw = await reviveCall(
        storeAddress as `0x${string}`,
        encodeGetValues(),
        ownerSS58Address
      )
      storeLabels = decodeStringArray(raw)
    } catch {
      // Skip failed store without persisting — next sync will retry it.
      continue
    }

    const normalized: string[] = []
    const entry: StoreEntry = {
      storeAddress,
      ownerH160Address,
      ownerSS58Address,
      labels: normalized
    }
    stores.set(storeAddress, entry)
    // Push the store eagerly and persist immediately so downstream readers
    // (and the test harness) see stores in localStorage as soon as each one
    // is discovered, rather than waiting for the next flush. If the sync is
    // interrupted before the inner loop finishes, the incomplete-label-metadata
    // check in syncAllApps will re-scan this store on the next sync.
    newStoreEntries.push(entry)
    await updateStores(newStoreEntries)

    for (const l of storeLabels) {
      if (!l) continue
      const n = l.endsWith('.dot') ? l.slice(0, -4) : l
      if (n.includes('.')) continue
      normalized.push(n)
      if (!seenLabels.has(n)) {
        seenLabels.add(n)
        pending.push(n)
      }
      if (pending.length >= BATCH_SIZE) {
        await flushLabelBatch(stores, labels, pending, userH160, onProgress)
        await updateStores(newStoreEntries)
        pending = []
      }
    }

    const scanned = i + 1
    if (scanned % 10 === 0 || scanned === addresses.length) {
      const total = materialize([...stores.values()], labels).length
      hiddenLog(
        `Synchronization status: ${scanned} of ${addresses.length} stores. Total: ${total} apps`
      )
    }
  }

  if (pending.length > 0) {
    await flushLabelBatch(stores, labels, pending, userH160, onProgress)
  }

  await updateStores(newStoreEntries)
}

async function resolveUserH160(): Promise<`0x${string}` | null> {
  try {
    const { publicKey } = await attestationService.getSigner()
    const ss58 = AccountId().dec(publicKey)
    return ss58ToEthereum(ss58 as SS58String).asHex() as `0x${string}`
  } catch {
    return null
  }
}

async function syncAllApps(
  cachedStores: StoreEntry[],
  cachedLabels: LabelEntry[],
  onProgress?: (apps: AppEntry[]) => void
): Promise<AppEntry[]> {
  const t0 = performance.now()
  hiddenLog(
    `Starting synchronization — cache holds ${cachedStores.length} stores, ${cachedLabels.length} labels`
  )
  const stores = new Map(cachedStores.map((s) => [s.storeAddress, s]))
  const labels = new Map(cachedLabels.map((l) => [l.label, l]))

  let current: string[]
  const storesT0 = performance.now()
  hiddenLog(
    `Fetching deployed stores: reviveCall(${CONTRACTS.STORE_FACTORY}, getAllDeployedStores())`
  )
  try {
    const raw = await reviveCall(CONTRACTS.STORE_FACTORY, encodeGetAllDeployedStores())
    current = decodeAddressArray(raw).map((a) => a.toLowerCase())
  } catch (err) {
    hiddenLog(`Failed to fetch deployed stores: ${err}`, 'error')
    return materialize([...stores.values()], labels)
  }
  hiddenLog(
    `Received ${current.length} store addresses (${(performance.now() - storesT0).toFixed(0)}ms)`
  )

  // Remove stores that no longer exist
  const currentSet = new Set(current)
  const toDelete: string[] = []
  for (const addr of stores.keys()) {
    if (!currentSet.has(addr)) toDelete.push(addr)
  }
  if (toDelete.length > 0) {
    hiddenLog(`Removing ${toDelete.length} stale stores`)
    await removeStores(toDelete)
    for (const addr of toDelete) stores.delete(addr)
  }

  // Detect cached stores that were persisted with incomplete label metadata
  // (legacy state from before we persisted non-live labels). Drop them so they
  // get re-scanned below.
  const incomplete: string[] = []
  for (const [addr, store] of stores) {
    if (store.labels.some((l) => !labels.has(l))) incomplete.push(addr)
  }
  if (incomplete.length > 0) {
    hiddenLog(`Re-scanning ${incomplete.length} stores with incomplete data`)
    await removeStores(incomplete)
    for (const addr of incomplete) stores.delete(addr)
  }

  // Only scan stores not yet cached
  const toScan = current.filter((addr) => !stores.has(addr))

  // Refresh labels whose metadata is older than the TTL (or missing a timestamp
  // from a pre-TTL cache). Runs through flushLabelBatch so contenthash is also
  // re-checked — a label that went non-live since last sync gets detected here.
  const nowMs = Date.now()
  const staleLabels: string[] = []
  for (const l of labels.values()) {
    if (!l.fetchedAt || nowMs - l.fetchedAt > METADATA_TTL_MS) staleLabels.push(l.label)
  }

  if (toScan.length > 0 || staleLabels.length > 0) {
    const userH160 = await resolveUserH160()

    if (staleLabels.length > 0) {
      hiddenLog(
        `Refreshing ${staleLabels.length} stale label(s) (TTL ${METADATA_TTL_MS / 3_600_000}h)`
      )
      await flushLabelBatch(stores, labels, staleLabels, userH160, onProgress)
    }

    if (toScan.length > 0) {
      hiddenLog(
        `Scanning ${toScan.length} new stores${userH160 ? ' (including your attestations)' : ''}`
      )
      await scanStores(toScan, stores, labels, userH160, onProgress)
    }
  }

  const apps = materialize([...stores.values()], labels)
  hiddenLog(
    `Synchronization complete: ${apps.length} apps in ${((performance.now() - t0) / 1000).toFixed(1)}s`
  )
  return apps
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
    // updatedAt: 0 marks the cached data as stale so useQuery will trigger a
    // background refetch (the actual chain sync) when a subscriber mounts.
    queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, cached, { updatedAt: 0 })
  }
}

async function resolveLabel(name: string): Promise<AppEntry | null> {
  // Fast path: if we've already scanned this label during a previous sync, the
  // metadata is in the labels blob. Avoids an on-chain round-trip.
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

  const node = namehash(`${name}.dot`)
  const calls: MulticallTarget[] = [
    { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeContenthash(node) },
    { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, 'name') },
    { target: CONTRACTS.CONTENT_RESOLVER, callData: encodeText(node, 'description') }
  ]
  const results = await multicall(calls)

  const contentHash = tryDecode(results[0], (d) => decodeIpfsContenthash(decodeBytes(d)))
  if (!contentHash) return null

  return {
    label: name,
    name: tryDecode(results[1], decodeString) || null,
    description: tryDecode(results[2], decodeString) || 'No description',
    contentHash,
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
