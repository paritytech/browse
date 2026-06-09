/**
 * Remote reads for the apps subsystem.
 *
 * Inputs are plain values, outputs are decoded chain data. Persistence,
 * chunking, and progress reporting live in `./sync`.
 */

import { keccak_256 } from '@noble/hashes/sha3.js'
import { publisherReadAddresses } from '@parity/browse-sdk'

import { parseRootManifest } from './manifest'
import type { LabelEntry } from '../../db/labels'
import {
  decodeAddress,
  decodeBool,
  decodeBytes,
  decodeBytes32Array,
  decodeIpfsContenthash,
  decodeString,
  decodeUint64,
  encodeContenthash,
  encodeCountByRecipientAndSchema,
  encodeGetPublished,
  encodeIsActive,
  encodeIsActiveAny,
  encodeLabelOf,
  encodeNodeOwner,
  encodeText,
  labelhashToTokenId,
  type MulticallTarget,
  namehash,
  nodeToSubject
} from '../../lib/abi'
import { reviveCall } from '../../lib/client'
import { NETWORK } from '../../lib/config'
import { hiddenLog } from '../../lib/debug'
import { multicall } from '../../lib/multicall'

const PUBLISHER_PAGE_LIMIT = 1000n

export const HYDRATE_CHUNK_SIZE = 30

/** Decode one Multicall3 sub-result, swallowing per-call failures as `null`. */
export function tryDecode<T>(
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

/** `keccak256(bytes(label))`, the dotNS labelhash for a bare `.dot` label. */
export function labelhashOf(label: string): `0x${string}` {
  const bytes = new TextEncoder().encode(label)
  const hash = keccak_256(bytes)
  let out = '0x'
  for (let i = 0; i < hash.length; i++) out += hash[i].toString(16).padStart(2, '0')
  return out as `0x${string}`
}

/**
 * Read the full published-set labelhashes from `Publisher.getPublished`.
 *
 * Order is not stable across unpublishes (Publisher uses swap-and-pop) so
 * callers should reduce by labelhash. Retries once with a 1s backoff. Empty
 * array when no Publisher is configured for the active network.
 */
export async function readPublishedLabelhashes(): Promise<`0x${string}`[]> {
  const publishers = publisherReadAddresses(NETWORK)
  if (publishers.length === 0) {
    hiddenLog('Publisher not deployed on this network; returning empty set', 'error')
    return []
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await readPublishedLabelhashesOnce(publishers)
    } catch (err) {
      if (attempt === 1) throw err
      hiddenLog(`getPublished failed (attempt ${attempt + 1}/2): ${err}`, 'error')
      await sleep(1_000)
    }
  }
  return []
}

async function readPublishedLabelhashesOnce(publishers: `0x${string}`[]): Promise<`0x${string}`[]> {
  const seen = new Set<string>()
  const all: `0x${string}`[] = []
  for (const publisher of publishers) {
    let offset = 0n
    for (;;) {
      const raw = await reviveCall(publisher, encodeGetPublished(offset, PUBLISHER_PAGE_LIMIT))
      const page = decodeBytes32Array(raw)
      for (const labelhash of page) {
        if (seen.has(labelhash)) continue
        seen.add(labelhash)
        all.push(labelhash)
      }
      if (page.length < Number(PUBLISHER_PAGE_LIMIT)) break
      offset += PUBLISHER_PAGE_LIMIT
    }
  }
  return all
}

/**
 * Resolve labelhashes to `.dot` label strings via `registrar.labelOf`.
 *
 * Hashes already represented in `cached` are reused; only the remainder
 * hits the chain (single Multicall3 batch).
 */
export async function resolveLabels(
  labelhashes: `0x${string}`[],
  cached: ReadonlyMap<string, LabelEntry>
): Promise<Map<`0x${string}`, string>> {
  const result = new Map<`0x${string}`, string>()
  const cachedByHash = new Map<`0x${string}`, string>()
  for (const entry of cached.values()) cachedByHash.set(labelhashOf(entry.label), entry.label)

  const toResolve: `0x${string}`[] = []
  for (const labelhash of labelhashes) {
    const hit = cachedByHash.get(labelhash)
    if (hit) result.set(labelhash, hit)
    else toResolve.push(labelhash)
  }
  if (toResolve.length === 0) return result

  hiddenLog(
    `Resolving ${toResolve.length} new labelhashes: multicall(${NETWORK.MULTICALL3}, [labelOf×${toResolve.length}])`
  )
  const calls: MulticallTarget[] = toResolve.map((lh) => ({
    target: NETWORK.REGISTRAR,
    callData: encodeLabelOf(labelhashToTokenId(lh))
  }))
  const results = await multicall(calls)
  for (let i = 0; i < toResolve.length; i++) {
    const name = tryDecode(results[i], decodeString)
    if (name) result.set(toResolve[i], name)
  }
  return result
}

/**
 * Hydrate a chunk of labels with content + attestation metadata.
 *
 * Two-pass: first batch fetches `contenthash` to identify live labels, the
 * second batch fetches `name`/`description`/attestation count (plus a per-user
 * "have I attested?" probe when `userH160` is provided). Non-live labels come
 * back with `contentHash: null`. Caller chunks input to {@link HYDRATE_CHUNK_SIZE}.
 */
export async function hydrateLabelChunk(
  chunk: string[],
  userH160: `0x${string}` | null
): Promise<LabelEntry[]> {
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
  for (let chunkIndex = 0; chunkIndex < chunk.length; chunkIndex++) {
    if (contentHashes[chunkIndex]) liveIndexes.push(chunkIndex)
  }

  // Per live label: manifest, worker owner, like count, compliance attestation,
  // and (when signed in) the per-user "have I liked this?" probe.
  const callsPerLive = userH160 ? 5 : 4
  let metaResults: Awaited<ReturnType<typeof multicall>> = []
  if (liveIndexes.length > 0) {
    const metaCalls: MulticallTarget[] = []
    for (const chunkIndex of liveIndexes) {
      const node = namehash(`${chunk[chunkIndex]}.dot`)
      const workerNode = namehash(`worker.${chunk[chunkIndex]}.dot`)
      const subject = nodeToSubject(node)
      metaCalls.push(
        { target: NETWORK.CONTENT_RESOLVER, callData: encodeText(node, 'manifest') },
        { target: NETWORK.REGISTRY, callData: encodeNodeOwner(workerNode) },
        {
          target: NETWORK.ATTESTATION_INDEX_RESOLVER,
          callData: encodeCountByRecipientAndSchema(subject, NETWORK.SCHEMA_ID)
        },
        {
          target: NETWORK.TRUSTED_ATTESTER_RESOLVER,
          callData: encodeIsActive(subject, NETWORK.COMPLIANCE_SCHEMA_ID)
        }
      )
      if (userH160) {
        metaCalls.push({
          target: NETWORK.ATTESTATION_INDEX_RESOLVER,
          callData: encodeIsActiveAny(subject, NETWORK.SCHEMA_ID, [userH160])
        })
      }
    }
    hiddenLog(
      `Fetching metadata for ${liveIndexes.length} live labels: multicall(${NETWORK.MULTICALL3}, [${metaCalls.length} calls])`
    )
    metaResults = await multicall(metaCalls)
  }

  const fetchedAt = Date.now()
  const out: LabelEntry[] = []
  let metaIdx = 0
  for (let chunkIndex = 0; chunkIndex < chunk.length; chunkIndex++) {
    const cid = contentHashes[chunkIndex]
    let name: string | null = null
    let description = 'No description'
    let iconCid: string | null = null
    let hasChat = false
    let attestationCount: number | null = null
    let isCompliant = false
    let hasUserAttested = false
    if (cid) {
      const base = metaIdx * callsPerLive
      const manifestRaw = tryDecode(metaResults[base], decodeString) ?? ''
      const manifest = parseRootManifest(manifestRaw)
      if (manifest) {
        name = manifest.displayName
        description = manifest.description || 'No description'
        iconCid = manifest.icon.cid
      }
      const workerOwner = tryDecode(metaResults[base + 1], decodeAddress)
      hasChat = workerOwner !== null && workerOwner !== '0x0000000000000000000000000000000000000000'
      attestationCount = tryDecode(metaResults[base + 2], decodeUint64)
      isCompliant = tryDecode(metaResults[base + 3], decodeBool) ?? false
      hasUserAttested = userH160 ? (tryDecode(metaResults[base + 4], decodeBool) ?? false) : false
      metaIdx++
    }
    out.push({
      label: chunk[chunkIndex],
      name,
      description,
      iconCid,
      hasChat,
      contentHash: cid,
      attestationCount,
      isCompliant,
      hasUserAttested,
      fetchedAt
    })
  }
  return out
}

/**
 * Read a single label's content-resolver fields.
 *
 * Returns `null` when the label has no content hash (treated as not-an-app).
 * Used by the search-bar single-label resolver.
 */
export async function readContentByName(label: string): Promise<{
  contentHash: string
  name: string | null
  description: string
  iconCid: string | null
  hasChat: boolean
} | null> {
  const node = namehash(`${label}.dot`)
  const workerNode = namehash(`worker.${label}.dot`)
  const calls: MulticallTarget[] = [
    { target: NETWORK.CONTENT_RESOLVER, callData: encodeContenthash(node) },
    { target: NETWORK.CONTENT_RESOLVER, callData: encodeText(node, 'manifest') },
    { target: NETWORK.REGISTRY, callData: encodeNodeOwner(workerNode) }
  ]
  const results = await multicall(calls)
  const contentHash = tryDecode(results[0], (data) => decodeIpfsContenthash(decodeBytes(data)))
  if (!contentHash) return null
  const manifest = parseRootManifest(tryDecode(results[1], decodeString) ?? '')
  const workerOwner = tryDecode(results[2], decodeAddress)
  return {
    contentHash,
    name: manifest?.displayName ?? null,
    description: manifest?.description || 'No description',
    iconCid: manifest?.icon.cid ?? null,
    hasChat: workerOwner !== null && workerOwner !== '0x0000000000000000000000000000000000000000'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
