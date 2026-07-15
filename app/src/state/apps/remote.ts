/**
 * Remote reads for the apps subsystem.
 *
 * Inputs are plain values, outputs are decoded chain data. Persistence,
 * chunking, and progress reporting live in `./sync`.
 */

import { keccak_256 } from '@noble/hashes/sha3.js'
import { attestationVersions, publisherReadAddresses } from '@parity/browse-sdk'
import { decodeFunctionResult, encodeFunctionData, parseAbi, toHex } from 'viem'

import { parseRootManifest } from './manifest'
import type { AppCertificate } from './types'
import type { LabelEntry } from '../../db/labels'
import {
  decodeAttestation,
  decodeBool,
  decodeBytes,
  decodeBytes32Array,
  decodeIpfsContenthash,
  decodeString,
  decodeUint64,
  encodeContenthash,
  encodeCountByRecipientAndSchema,
  encodeGetAttestationById,
  encodeGetPublished,
  encodeIdentityHasAttested,
  encodeLabelOf,
  encodeText,
  labelhashToTokenId,
  type MulticallTarget,
  namehash,
  nodeToSubject,
  trustedAttestationId
} from '../../lib/abi'
import { reviveCall } from '../../lib/client'
import { NETWORK } from '../../lib/config'
import { hiddenLog } from '../../lib/debug'
import { multicall } from '../../lib/multicall'
import type { CertificateAuthority, CertificateIdentity } from '../certificate-authorities/types'

const PUBLISHER_PAGE_LIMIT = 1000n

export const HYDRATE_CHUNK_SIZE = 30

/** The certificate identity carried by a decoded attestation, for a given issuer resolver. */
export function certificateIdentityFrom(
  decoded: NonNullable<ReturnType<typeof decodeAttestation>>,
  resolver: string
): CertificateIdentity {
  return {
    resolver,
    attester: decoded.attester,
    name: decoded.name,
    contentCid: decoded.cid,
    badgeIconCid: decoded.badgeIconCid
  }
}

const PUBLICATION_ABI = parseAbi([
  'function publicationOf(bytes32 labelhash) view returns ((address publisher, uint64 timestamp, uint32 indexPlusOne))'
])

function encodePublicationOf(labelhash: `0x${string}`): `0x${string}` {
  return encodeFunctionData({
    abi: PUBLICATION_ABI,
    functionName: 'publicationOf',
    args: [labelhash]
  })
}

/** Publish time in unix seconds from a `publicationOf` result, or null when the label is absent from that Publisher. */
function decodePublishedAt(data: `0x${string}`): number | null {
  const pub = decodeFunctionResult({
    abi: PUBLICATION_ABI,
    functionName: 'publicationOf',
    data
  }) as { timestamp: bigint; indexPlusOne: number }
  return pub.indexPlusOne === 0 ? null : Number(pub.timestamp)
}

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
 * Hydrate a chunk of labels with content and attestation metadata.
 *
 * Two-pass: first batch fetches `contenthash` to identify live labels, the
 * second batch fetches `name`/`description`/attestation count. When
 * `identityH160` is provided, it also runs a per-user "have I attested?" probe.
 * Non-live labels come back with `contentHash: null`. Caller chunks input to
 * {@link HYDRATE_CHUNK_SIZE}.
 */
export async function hydrateLabelChunk(
  chunk: string[],
  identityH160: `0x${string}` | null,
  authorities: CertificateAuthority[]
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

  const versions = attestationVersions(NETWORK)
  // Each label fetches one compliance attestation per authority. An active
  // record that is neither revoked nor expired marks the app certified by that
  // authority, so no separate `isActive` call is needed.
  const perLive = 1 + versions.length + authorities.length + (identityH160 ? versions.length : 0)
  let metaResults: Awaited<ReturnType<typeof multicall>> = []
  if (liveIndexes.length > 0) {
    const metaCalls: MulticallTarget[] = []
    for (const chunkIndex of liveIndexes) {
      const node = namehash(`${chunk[chunkIndex]}.dot`)
      const subject = nodeToSubject(node)
      metaCalls.push({ target: NETWORK.CONTENT_RESOLVER, callData: encodeText(node, 'manifest') })
      for (const { resolver, schemaId } of versions) {
        metaCalls.push({
          target: resolver,
          callData: encodeCountByRecipientAndSchema(subject, schemaId)
        })
      }
      for (const authority of authorities) {
        const attestationId = trustedAttestationId(
          authority.attester as `0x${string}`,
          subject,
          BigInt(authority.schemaId)
        )
        metaCalls.push({
          target: NETWORK.ATTESTATION_SERVICE,
          callData: encodeGetAttestationById(attestationId)
        })
      }
      if (identityH160) {
        for (const { resolver, schemaId } of versions) {
          metaCalls.push({
            target: resolver,
            callData: encodeIdentityHasAttested(subject, schemaId, identityH160)
          })
        }
      }
    }
    hiddenLog(
      `Fetching metadata for ${liveIndexes.length} live labels: multicall(${NETWORK.MULTICALL3}, [${metaCalls.length} calls])`
    )
    metaResults = await multicall(metaCalls)
  }

  // Publish time drives the freshness rank. A record for a label can live on any
  // deployed Publisher, since older records stay put across redeployments, so
  // probe each and keep the latest timestamp found.
  const publishedAtByIndex = new Map<number, number>()
  const publishers = publisherReadAddresses(NETWORK)
  if (liveIndexes.length > 0 && publishers.length > 0) {
    const pubCalls: MulticallTarget[] = []
    for (const chunkIndex of liveIndexes) {
      const labelhash = labelhashOf(chunk[chunkIndex])
      for (const publisher of publishers) {
        pubCalls.push({ target: publisher, callData: encodePublicationOf(labelhash) })
      }
    }
    const pubResults = await multicall(pubCalls)
    let p = 0
    for (const chunkIndex of liveIndexes) {
      let latest: number | null = null
      for (let i = 0; i < publishers.length; i++) {
        const ts = tryDecode(pubResults[p++], decodePublishedAt)
        if (ts !== null && (latest === null || ts > latest)) latest = ts
      }
      if (latest !== null) publishedAtByIndex.set(chunkIndex, latest)
    }
  }

  const fetchedAt = Date.now()
  const now = BigInt(Math.floor(fetchedAt / 1000))
  const out: LabelEntry[] = []
  let metaIdx = 0
  for (let chunkIndex = 0; chunkIndex < chunk.length; chunkIndex++) {
    const cid = contentHashes[chunkIndex]
    let name: string | null = null
    let description = 'No description'
    let iconCid: string | null = null
    let attestationCount: number | null = null
    const certificates: AppCertificate[] = []
    let hasUserAttested = false
    if (cid) {
      const base = metaIdx * perLive
      const manifestRaw = tryDecode(metaResults[base], decodeString) ?? ''
      const manifest = parseRootManifest(manifestRaw)
      if (manifest) {
        name = manifest.displayName
        description = manifest.description || 'No description'
        iconCid = manifest.icon.cid
      }
      let countTotal = 0
      let hasCount = false
      for (let v = 0; v < versions.length; v++) {
        const c = tryDecode(metaResults[base + 1 + v], decodeUint64)
        if (c !== null) {
          countTotal += c
          hasCount = true
        }
      }
      attestationCount = hasCount ? countTotal : null
      // One `getAttestationById` slot per authority follows the counts, so
      // `identityHasAttested` starts after them.
      const certBase = base + 1 + versions.length
      authorities.forEach((authority, i) => {
        const decoded = tryDecode(metaResults[certBase + i], decodeAttestation)
        // Keep only an active attestation, neither revoked nor expired. Its
        // presence marks the app certified by this authority.
        const active =
          decoded !== null &&
          decoded.revocationTime === 0n &&
          (decoded.expirationTime === 0n || decoded.expirationTime > now)
        if (decoded && active) {
          certificates.push({
            ...certificateIdentityFrom(decoded, authority.resolver),
            id: toHex(decoded.id, { size: 32 }),
            issuedAt: Number(decoded.time),
            expiresAt: Number(decoded.expirationTime)
          })
        }
      })
      if (identityH160) {
        const anyBase = certBase + authorities.length
        hasUserAttested = versions.some(
          (_, v) => tryDecode(metaResults[anyBase + v], decodeBool) === true
        )
      }
      metaIdx++
    }
    out.push({
      label: chunk[chunkIndex],
      name,
      description,
      iconCid,
      contentHash: cid,
      attestationCount,
      certificates,
      hasUserAttested,
      fetchedAt,
      publishedAt: publishedAtByIndex.get(chunkIndex)
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
} | null> {
  const node = namehash(`${label}.dot`)
  const calls: MulticallTarget[] = [
    { target: NETWORK.CONTENT_RESOLVER, callData: encodeContenthash(node) },
    { target: NETWORK.CONTENT_RESOLVER, callData: encodeText(node, 'manifest') }
  ]
  const results = await multicall(calls)
  const contentHash = tryDecode(results[0], (data) => decodeIpfsContenthash(decodeBytes(data)))
  if (!contentHash) return null
  const manifest = parseRootManifest(tryDecode(results[1], decodeString) ?? '')
  return {
    contentHash,
    name: manifest?.displayName ?? null,
    description: manifest?.description || 'No description',
    iconCid: manifest?.icon.cid ?? null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
