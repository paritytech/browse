import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query'
import { AccountId, type SS58String } from 'polkadot-api'

import { type AppEntry } from './types'
import { type AddressMap, readAllAddresses, writeAllAddresses } from '../../db/addresses'
import { type LabelEntry, readAllLabels, writeAllLabels } from '../../db/labels'
import { readAllStores, type StoreEntry, writeAllStores } from '../../db/stores'
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
  encodeGetLabels,
  encodeGetLabelStores,
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
import { BACKEND } from '../../lib/config'
import { hiddenLog } from '../../lib/debug'
import { isHosted } from '../../lib/local-storage'
import { multicall } from '../../lib/multicall'
const BATCH_SIZE = 200
const METADATA_TTL_MS = 24 * 60 * 60 * 1000
const STORE_FACTORY_PAGE_LIMIT = 1000
const LABEL_STORE_PAGE_LIMIT = 1000

const PCF_PRODUCTS: ReadonlyArray<{ label: string; name: string; description: string }> = [
  { label: 'coinflipgame03', name: 'Coin Flip', description: 'A simple coin flip app.' },
  { label: 'crosswords', name: 'Mini Crossword', description: 'A quick 5x5 crossword puzzle.' },
  { label: 'ohnotes', name: 'Notes', description: 'Notes that follow you everywhere.' }
]

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

async function cachedLookupSS58Address(
  h160Address: string,
  addresses: AddressMap
): Promise<string | null> {
  const normalizedH160Address = h160Address.toLowerCase()
  const cached = addresses[normalizedH160Address]
  if (cached) return cached
  const resolvedSS58Address = await lookupOriginalAccount(normalizedH160Address)
  if (resolvedSS58Address) addresses[normalizedH160Address] = resolvedSS58Address
  return resolvedSS58Address
}

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
      target: BACKEND.CONTENT_RESOLVER,
      callData: encodeContenthash(namehash(`${label}.dot`))
    }))
    hiddenLog(
      `Fetching content hashes: multicall(${BACKEND.MULTICALL3}, [contenthash×${chunk.length}])`
    )
    const chResults = await multicall(chCalls)

    const contentHashes: (string | null)[] = chunk.map((_, j) =>
      tryDecode(chResults[j], (d) => decodeIpfsContenthash(decodeBytes(d)))
    )
    const liveIndexes: number[] = []
    for (let j = 0; j < chunk.length; j++) {
      if (contentHashes[j]) liveIndexes.push(j)
    }

    const callsPerLive = userH160 ? 4 : 3
    let metaResults: Awaited<ReturnType<typeof multicall>> = []
    if (liveIndexes.length > 0) {
      const metaCalls: MulticallTarget[] = []
      for (const j of liveIndexes) {
        const node = namehash(`${chunk[j]}.dot`)
        const subject = nodeToSubject(node)
        metaCalls.push(
          { target: BACKEND.CONTENT_RESOLVER, callData: encodeText(node, 'name') },
          { target: BACKEND.CONTENT_RESOLVER, callData: encodeText(node, 'description') },
          {
            target: BACKEND.ATTESTATION_INDEX_RESOLVER,
            callData: encodeCountByRecipientAndSchema(subject, BACKEND.SCHEMA_ID)
          }
        )
        if (userH160) {
          metaCalls.push({
            target: BACKEND.ATTESTATION_INDEX_RESOLVER,
            callData: encodeIsActiveAny(subject, BACKEND.SCHEMA_ID, [userH160])
          })
        }
      }
      hiddenLog(
        `Fetching metadata for ${liveIndexes.length} live labels: multicall(${BACKEND.MULTICALL3}, [${metaCalls.length} calls])`
      )
      metaResults = await multicall(metaCalls)
    }

    const fetchedAt = Date.now()
    const chunkEntries: LabelEntry[] = []
    let metaIdx = 0
    for (let j = 0; j < chunk.length; j++) {
      const cid = contentHashes[j]
      let name: string | null = null
      let description = 'No description'
      let attestationCount: number | null = null
      let hasUserAttested = false
      if (cid) {
        const base = metaIdx * callsPerLive
        name = tryDecode(metaResults[base], decodeString) || null
        description = tryDecode(metaResults[base + 1], decodeString) || 'No description'
        attestationCount = tryDecode(metaResults[base + 2], decodeUint64)
        hasUserAttested = userH160 ? (tryDecode(metaResults[base + 3], decodeBool) ?? false) : false
        metaIdx++
      }
      const entry: LabelEntry = {
        label: chunk[j],
        name,
        description,
        contentHash: cid,
        attestationCount,
        hasUserAttested,
        fetchedAt
      }
      labels.set(chunk[j], entry)
      chunkEntries.push(entry)
    }

    onProgress?.(materialize([...stores.values()], labels))

    // Persist after the first chunk so cards-on-screen are durably backed
    // within seconds, not at the end of a long batch.
    if (i === 0) await writeAllLabels([...labels.values()])
  }

  // Final persist captures all labels resolved across remaining chunks.
  await writeAllLabels([...labels.values()])
}

async function scanStores(
  storeAddresses: string[],
  stores: Map<string, StoreEntry>,
  labels: Map<string, LabelEntry>,
  addressMap: AddressMap,
  userH160: `0x${string}` | null,
  onProgress?: (apps: AppEntry[]) => void
): Promise<void> {
  if (storeAddresses.length === 0) return

  const ownerCalls: MulticallTarget[] = storeAddresses.map((addr) => ({
    target: addr as `0x${string}`,
    callData: encodeOwner()
  }))
  const ownersT0 = performance.now()
  hiddenLog(`Fetching owners: multicall(${BACKEND.MULTICALL3}, [owner×${storeAddresses.length}])`)
  const ownerResults = await multicall(ownerCalls)
  hiddenLog(
    `Received ${ownerResults.length} owners (${(performance.now() - ownersT0).toFixed(0)}ms)`
  )

  const ownerH160Addresses: (string | null)[] = ownerResults.map((r) =>
    tryDecode(r, (d) => decodeAddress(d).toLowerCase())
  )

  const seenLabels = new Set<string>(labels.keys())
  let pending: string[] = []

  for (let i = 0; i < storeAddresses.length; i++) {
    const storeAddress = storeAddresses[i]
    const ownerH160Address = ownerH160Addresses[i]
    const ownerSS58Address = ownerH160Address
      ? await cachedLookupSS58Address(ownerH160Address, addressMap)
      : null

    if (!ownerSS58Address) {
      const entry: StoreEntry = {
        storeAddress,
        ownerH160Address,
        ownerSS58Address: null,
        labels: []
      }
      stores.set(storeAddress, entry)
      continue
    }

    let storeLabels: string[]
    try {
      const raw = await reviveCall(
        storeAddress as `0x${string}`,
        encodeGetLabels(0n, BigInt(LABEL_STORE_PAGE_LIMIT)),
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

    // Flush mid-scan so the UI shows cards while the per-store loop is still
    // running. Without this, materialize returns 0 apps until every store has
    // been scanned and the tail flush completes.
    if (pending.length >= BATCH_SIZE) {
      // Persist stores first so they're durable before the long label flush —
      // the labels Map gets its own early persist inside flushLabelBatch.
      await writeAllStores([...stores.values()])
      await flushLabelBatch(stores, labels, pending, userH160, onProgress)
      pending = []
    }

    const scanned = i + 1
    if (scanned % 10 === 0 || scanned === storeAddresses.length) {
      const total = materialize([...stores.values()], labels).length
      hiddenLog(
        `Synchronization status: ${scanned} of ${storeAddresses.length} stores. Total: ${total} apps`
      )
    }
  }

  if (pending.length > 0) {
    await flushLabelBatch(stores, labels, pending, userH160, onProgress)
  }

  await writeAllStores([...stores.values()])
  await writeAllAddresses(addressMap)
}

async function resolveUserH160(): Promise<`0x${string}` | null> {
  try {
    const { publicKey } = await attestationService.getSigner()
    const ss58 = AccountId().dec(publicKey)
    return ss58ToEthereum(ss58 as SS58String) as `0x${string}`
  } catch {
    return null
  }
}

async function syncAllApps(
  cachedStores: StoreEntry[],
  cachedLabels: LabelEntry[],
  cachedAddresses: AddressMap,
  onProgress?: (apps: AppEntry[]) => void
): Promise<AppEntry[]> {
  const t0 = performance.now()
  hiddenLog(
    `Starting synchronization — cache holds ${cachedStores.length} stores, ${cachedLabels.length} labels`
  )
  const stores = new Map(cachedStores.map((s) => [s.storeAddress, s]))
  const labels = new Map(cachedLabels.map((l) => [l.label, l]))
  const addresses = { ...cachedAddresses }

  let current: string[]
  try {
    const raw = await reviveCall(
      BACKEND.STORE_FACTORY,
      encodeGetLabelStores(0n, BigInt(STORE_FACTORY_PAGE_LIMIT))
    )
    current = decodeAddressArray(raw).map((a) => a.toLowerCase())
  } catch (err) {
    hiddenLog(`Failed to fetch deployed stores: ${err}`, 'error')
    return materialize([...stores.values()], labels)
  }

  // Drop stores that no longer exist on chain.
  const currentSet = new Set(current)
  let dirty = false
  for (const addr of [...stores.keys()]) {
    if (!currentSet.has(addr)) {
      stores.delete(addr)
      dirty = true
    }
  }

  // Drop cached stores persisted with incomplete label metadata (legacy state
  // from before non-live labels were persisted) so they get re-scanned below.
  for (const [addr, store] of [...stores]) {
    if (store.labels.some((l) => !labels.has(l))) {
      stores.delete(addr)
      dirty = true
    }
  }
  if (dirty) await writeAllStores([...stores.values()])

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
      await scanStores(toScan, stores, labels, addresses, userH160, onProgress)
    }
  }

  const apps = materialize([...stores.values()], labels)
  hiddenLog(
    `Synchronization complete: ${apps.length} apps in ${((performance.now() - t0) / 1000).toFixed(1)}s`
  )
  return apps
}

const ALL_APPS_KEY = ['apps', 'all'] as const

// Shared between prefetchAllApps and the queryFn so the cached stores, labels,
// and addresses blobs are read from the host bridge once at app startup.
interface InitialDiskState {
  stores: StoreEntry[]
  labels: LabelEntry[]
  addresses: AddressMap
}

let initialDiskLoad: Promise<InitialDiskState> | null = null

function loadInitialDiskState(): Promise<InitialDiskState> {
  if (!initialDiskLoad) {
    initialDiskLoad = Promise.all([readAllStores(), readAllLabels(), readAllAddresses()]).then(
      ([stores, labels, addresses]) => ({ stores, labels, addresses })
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
      const {
        stores: cachedStores,
        labels: cachedLabels,
        addresses: cachedAddresses
      } = await loadInitialDiskState()
      const finalApps = await syncAllApps(
        cachedStores,
        cachedLabels,
        cachedAddresses,
        (progressApps) => {
          queryClient.setQueryData<AppEntry[]>(ALL_APPS_KEY, (prev) => merge(prev, progressApps))
        }
      )
      return merge(queryClient.getQueryData<AppEntry[]>(ALL_APPS_KEY), finalApps)
    },
    staleTime: 5 * 60_000
  })
}

export function useGetAllApps(queryClient: QueryClient) {
  return useQuery(getAllAppsOptions(queryClient))
}

export async function prefetchAllApps(queryClient: QueryClient) {
  const { stores, labels: labelEntries } = await loadInitialDiskState()
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
    { target: BACKEND.CONTENT_RESOLVER, callData: encodeContenthash(node) },
    { target: BACKEND.CONTENT_RESOLVER, callData: encodeText(node, 'name') },
    { target: BACKEND.CONTENT_RESOLVER, callData: encodeText(node, 'description') }
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
