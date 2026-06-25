/**
 * Legacy discovery path. Scans every per-user dotns LabelStore via the
 * StoreFactory enumeration, hydrates each label via the content resolver,
 * and materialises AppEntry rows from the result.
 *
 * Nothing in this module is wired into the live app today.
 */

import { attestationVersions } from '@parity/browse-sdk'
import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { AccountId, type SS58String } from 'polkadot-api'

import { type AppEntry } from './types'
import { type AddressMap, readAllAddresses, writeAllAddresses } from '../../db/addresses'
import { createOrUpdateLabels, type LabelEntry, readLabels } from '../../db/labels'
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
import { lookupOriginalAccount, reviveCall } from '../../lib/client'
import { NETWORK } from '../../lib/config'
import { hiddenLog } from '../../lib/debug'
import { multicall } from '../../lib/multicall'

const BATCH_SIZE = 200
const METADATA_TTL_MS = 24 * 60 * 60 * 1000
const STORE_FACTORY_PAGE_LIMIT = 1000
const LABEL_STORE_PAGE_LIMIT = 1000
const FLUSH_CHUNK_SIZE = 30

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

function labelToApp(l: LabelEntry): AppEntry {
  return {
    label: l.label,
    name: l.name,
    description: l.description,
    iconCid: l.iconCid ?? null,
    contentHash: l.contentHash,
    isLive: l.contentHash !== null,
    attestationCount: l.attestationCount,
    hasUserAttested: l.hasUserAttested,
    isCompliant: l.isCompliant ?? false
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
      target: NETWORK.CONTENT_RESOLVER,
      callData: encodeContenthash(namehash(`${label}.dot`))
    }))
    hiddenLog(
      `Fetching content hashes: multicall(${NETWORK.MULTICALL3}, [contenthash×${chunk.length}])`
    )
    const chResults = await multicall(chCalls)

    const contentHashes: (string | null)[] = chunk.map((_, chunkIndex) =>
      tryDecode(chResults[chunkIndex], (data) => decodeIpfsContenthash(decodeBytes(data)))
    )
    const liveIndexes: number[] = []
    for (let j = 0; j < chunk.length; j++) {
      if (contentHashes[j]) liveIndexes.push(j)
    }

    const versions = attestationVersions(NETWORK)
    const perLive = 2 + versions.length + (userH160 ? versions.length : 0)
    let metaResults: Awaited<ReturnType<typeof multicall>> = []
    if (liveIndexes.length > 0) {
      const metaCalls: MulticallTarget[] = []
      for (const j of liveIndexes) {
        const node = namehash(`${chunk[j]}.dot`)
        const subject = nodeToSubject(node)
        metaCalls.push(
          { target: NETWORK.CONTENT_RESOLVER, callData: encodeText(node, 'name') },
          { target: NETWORK.CONTENT_RESOLVER, callData: encodeText(node, 'description') }
        )
        for (const { resolver, schemaId } of versions) {
          metaCalls.push({
            target: resolver,
            callData: encodeCountByRecipientAndSchema(subject, schemaId)
          })
        }
        if (userH160) {
          for (const { resolver, schemaId } of versions) {
            metaCalls.push({
              target: resolver,
              callData: encodeIsActiveAny(subject, schemaId, [userH160])
            })
          }
        }
      }
      hiddenLog(
        `Fetching metadata for ${liveIndexes.length} live labels: multicall(${NETWORK.MULTICALL3}, [${metaCalls.length} calls])`
      )
      metaResults = await multicall(metaCalls)
    }

    const fetchedAt = Date.now()
    let metaIdx = 0
    for (let j = 0; j < chunk.length; j++) {
      const cid = contentHashes[j]
      let name: string | null = null
      let description = 'No description'
      let attestationCount: number | null = null
      let hasUserAttested = false
      if (cid) {
        const base = metaIdx * perLive
        name = tryDecode(metaResults[base], decodeString) || null
        description = tryDecode(metaResults[base + 1], decodeString) || 'No description'
        let countTotal = 0
        let hasCount = false
        for (let v = 0; v < versions.length; v++) {
          const c = tryDecode(metaResults[base + 2 + v], decodeUint64)
          if (c !== null) {
            countTotal += c
            hasCount = true
          }
        }
        attestationCount = hasCount ? countTotal : null
        if (userH160) {
          const anyBase = base + 2 + versions.length
          hasUserAttested = versions.some(
            (_, v) => tryDecode(metaResults[anyBase + v], decodeBool) === true
          )
        }
        metaIdx++
      }
      const entry: LabelEntry = {
        label: chunk[j],
        name,
        description,
        iconCid: null,
        contentHash: cid,
        attestationCount,
        hasUserAttested,
        fetchedAt
      }
      labels.set(chunk[j], entry)
    }

    onProgress?.(materialize([...stores.values()], labels))

    // Persist after the first chunk so cards-on-screen are durably backed
    // within seconds, not at the end of a long batch.
    if (i === 0) await createOrUpdateLabels([...labels.values()])
  }

  // Final persist captures all labels resolved across remaining chunks.
  await createOrUpdateLabels([...labels.values()])
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
  hiddenLog(`Fetching owners: multicall(${NETWORK.MULTICALL3}, [owner×${storeAddresses.length}])`)
  const ownerResults = await multicall(ownerCalls)
  hiddenLog(
    `Received ${ownerResults.length} owners (${(performance.now() - ownersT0).toFixed(0)}ms)`
  )

  const ownerH160Addresses: (string | null)[] = ownerResults.map((result) =>
    tryDecode(result, (data) => decodeAddress(data).toLowerCase())
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
      // Skip failed store without persisting; next sync will retry it.
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

    for (const rawLabel of storeLabels) {
      if (!rawLabel) continue
      const bareLabel = rawLabel.endsWith('.dot') ? rawLabel.slice(0, -4) : rawLabel
      if (bareLabel.includes('.')) continue
      normalized.push(bareLabel)
      if (!seenLabels.has(bareLabel)) {
        seenLabels.add(bareLabel)
        pending.push(bareLabel)
      }
    }

    // Without this, materialize returns 0 apps until every store has
    // been scanned and the tail flush completes.
    if (pending.length >= BATCH_SIZE) {
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

export async function syncAllAppsViaDotns(
  cachedStores: StoreEntry[],
  cachedLabels: LabelEntry[],
  cachedAddresses: AddressMap,
  onProgress?: (apps: AppEntry[]) => void
): Promise<AppEntry[]> {
  const t0 = performance.now()
  hiddenLog(
    `Starting synchronization - cache holds ${cachedStores.length} stores, ${cachedLabels.length} labels`
  )
  const stores = new Map(cachedStores.map((store) => [store.storeAddress, store]))
  const labels = new Map(cachedLabels.map((entry) => [entry.label, entry]))
  const addresses = { ...cachedAddresses }

  let current: string[]
  try {
    const raw = await reviveCall(
      NETWORK.STORE_FACTORY,
      encodeGetLabelStores(0n, BigInt(STORE_FACTORY_PAGE_LIMIT))
    )
    current = decodeAddressArray(raw).map((addr) => addr.toLowerCase())
  } catch (err) {
    hiddenLog(`sFailed to fetch deployed stores: ${err}`, 'error')
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
    if (store.labels.some((label) => !labels.has(label))) {
      stores.delete(addr)
      dirty = true
    }
  }
  if (dirty) await writeAllStores([...stores.values()])

  // Only scan stores not yet cached
  const toScan = current.filter((addr) => !stores.has(addr))

  // Refresh labels whose metadata is older than the TTL (or missing a timestamp
  // from a pre-TTL cache). Runs through flushLabelBatch so contenthash is also
  // re-checked, so a label that went non-live since last sync gets detected here.
  const nowMs = Date.now()
  const staleLabels: string[] = []
  for (const entry of labels.values()) {
    if (!entry.fetchedAt || nowMs - entry.fetchedAt > METADATA_TTL_MS) staleLabels.push(entry.label)
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

interface LegacyDiskState {
  stores: StoreEntry[]
  labels: LabelEntry[]
  addresses: AddressMap
}

export function loadLegacyDiskState(): Promise<LegacyDiskState> {
  return Promise.all([readAllStores(), readLabels(), readAllAddresses()]).then(
    ([stores, labels, addresses]) => ({ stores, labels, addresses })
  )
}
