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
} from './lib/abi'
import { lookupOriginalAccount, reviveCall } from './lib/client'
import { CONTRACTS } from './lib/config'
import { dlog } from './lib/debug'
import { multicall } from './lib/multicall'
import { fetchStoreProducts } from './lib/store'

export interface AppEntry {
  label: string
  name: string | null
  description: string
  contentHash: string | null
  isLive: boolean
  vouchCount: number | null
  source: 'pcf' | 'all'
}

export type FilterMode = 'pcf' | 'all'

export function displayName(app: AppEntry): string {
  return app.name ?? `${app.label}.dot`
}

export type OnLabelsFound = (apps: AppEntry[]) => void

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
      if (i % 20 === 0) await new Promise<void>((r) => setTimeout(r, 0))
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

    if (s % 5 === 0) await new Promise<void>((r) => setTimeout(r, 0))
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

const MOCK_PCF_APPS: AppEntry[] = [
  {
    label: 'explore',
    name: 'Explore',
    description: 'Discover apps and curated collections on Polkadot',
    contentHash: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    isLive: true,
    vouchCount: 15,
    source: 'pcf'
  },
  {
    label: 'getsome',
    name: 'Get Some',
    description: 'The easiest way to get DOT, USDC & USDT on Polkadot',
    contentHash: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    isLive: true,
    vouchCount: 12,
    source: 'pcf'
  },
  {
    label: 'ohnotes',
    name: 'Notes',
    description: 'Notes that follow you everywhere.',
    contentHash: 'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenosa7714',
    isLive: true,
    vouchCount: 9,
    source: 'pcf'
  },
  {
    label: 'ignite',
    name: 'Ignite',
    description:
      'Create a campaign in minutes. Back projects you believe in. Trustless. Transparent. On-chain.',
    contentHash: 'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenosa7714',
    isLive: true,
    vouchCount: 10,
    source: 'pcf'
  },
  {
    label: 'market',
    name: 'Market',
    description: 'Buy and sell digital & physical goods',
    contentHash: 'bafybeibml5uieyxa5tufngvg7fgmrkpvp2rmelbbq4wyqkek5buthpholy',
    isLive: true,
    vouchCount: 18,
    source: 'pcf'
  }
]

export function isHosted(): boolean {
  const isIframe = window !== window.top
  const isWebview = (window as unknown as Record<string, unknown>)['__HOST_WEBVIEW_MARK__'] === true
  return isIframe || isWebview
}

export type GetAppsResult =
  | { status: 'ok'; apps: AppEntry[] }
  | { status: 'error'; message: string }
  | { status: 'mock'; apps: AppEntry[] }

export async function getPcfApps(): Promise<GetAppsResult> {
  const hosted = isHosted()
  if (!hosted) {
    return { status: 'mock', apps: MOCK_PCF_APPS }
  }
  try {
    const apps = await fetchPcfApps()
    return { status: 'ok', apps }
  } catch (err) {
    dlog(`PCF fetch failed: ${err}`, 'error')
    return { status: 'mock', apps: MOCK_PCF_APPS }
  }
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

export function filterApps(apps: AppEntry[], query: string, mode: FilterMode = 'pcf'): AppEntry[] {
  let filtered = apps.filter((app) => app.source === mode)

  const q = query.toLowerCase().trim()
  if (q) {
    filtered = filtered.filter(
      (app) =>
        app.label.toLowerCase().includes(q) ||
        (app.name?.toLowerCase().includes(q) ?? false) ||
        app.description.toLowerCase().includes(q)
    )
  }

  return filtered.sort((a, b) => displayName(a).localeCompare(displayName(b)))
}
