/**
 * Verifiable `.dot` domain snapshot, client read path for autocompletion.
 *
 * A daily job publishes to Bulletin one gzipped block per 2-char prefix shard
 * (sorted bare labels) plus a `manifest` block listing every shard CID. Each
 * block is a `CIDv1(raw, blake2b-256)`, resolved through the host preimage
 * bridge keyed by the blake2b digest. The CID is the integrity check: the host
 * only returns bytes whose blake2b-256 hash matches the key.
 *
 * Ported from apps/store. `DOMAINS_SNAPSHOT_CID` is the manifest CID. Any lookup
 * or decode failure degrades to `[]`, so suggestions simply close.
 */

import { getPreimageManager } from '@parity/product-sdk/host'

import { ASSETHUB_GENESIS, DOMAINS_SNAPSHOT_CID } from './config'

interface DomainsSnapshotManifest {
  version: number
  generatedAt: number
  network: string
  shardScheme: { prefixLen: 2; count: number }
  shards: Record<string, { cid: string; count: number }>
}

export const SNAPSHOT_MIN_PREFIX = 2
const MAX_SUGGESTIONS = 8
const LOOKUP_TIMEOUT_MS = 8_000

const BLAKE2B_256_RAW_CIDV1_PREFIX = new Uint8Array([0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20])
const DIGEST_BYTES = 32
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

function base32Decode(s: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let buf = 0
  for (let i = 0; i < s.length; i++) {
    const v = BASE32_ALPHABET.indexOf(s[i])
    if (v < 0) throw new Error(`Invalid base32 character: ${s[i]}`)
    buf = (buf << 5) | v
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

/** Decode a base32 CIDv1 and return its blake2b-256 digest as a hex preimage key. */
function cidToBlake2b256DigestHex(cid: string): `0x${string}` {
  if (!cid.startsWith('b')) throw new Error('CID is not a base32 CIDv1')
  const bytes = base32Decode(cid.slice(1))
  if (bytes.length !== BLAKE2B_256_RAW_CIDV1_PREFIX.length + DIGEST_BYTES) {
    throw new Error('unexpected CID length')
  }
  for (let i = 0; i < BLAKE2B_256_RAW_CIDV1_PREFIX.length; i++) {
    if (bytes[i] !== BLAKE2B_256_RAW_CIDV1_PREFIX[i])
      throw new Error('CID is not CIDv1(raw, blake2b-256)')
  }
  const digest = bytes.slice(BLAKE2B_256_RAW_CIDV1_PREFIX.length)
  let hex = '0x'
  for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, '0')
  return hex as `0x${string}`
}

/** Resolve a `CIDv1(raw, blake2b-256)` block via the host preimage bridge. */
async function lookupPreimage(cid: string): Promise<Uint8Array | null> {
  let key: `0x${string}`
  try {
    key = cidToBlake2b256DigestHex(cid)
  } catch {
    return null
  }
  const manager = await getPreimageManager()
  if (!manager) return null
  return new Promise((resolve) => {
    let done = false
    const settle = (bytes: Uint8Array | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      subscription.unsubscribe()
      resolve(bytes)
    }
    const subscription = manager.lookup(key, (bytes) => {
      if (bytes) settle(new Uint8Array(bytes))
    })
    subscription.onInterrupt(() => settle(null))
    const timer = setTimeout(() => settle(null), LOOKUP_TIMEOUT_MS)
  })
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Response(
    new Blob([bytes as BufferSource]).stream().pipeThrough(new DecompressionStream('gzip'))
  )
  return stream.text()
}

let manifestPromise: Promise<DomainsSnapshotManifest | null> | null = null
let manifestCid: string | undefined
const shardCache = new Map<string, Promise<string[]>>()

function isManifest(value: unknown): value is DomainsSnapshotManifest {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    typeof m.version === 'number' &&
    typeof m.network === 'string' &&
    !!m.shardScheme &&
    typeof m.shardScheme === 'object' &&
    !!m.shards &&
    typeof m.shards === 'object'
  )
}

async function loadManifest(): Promise<DomainsSnapshotManifest | null> {
  const cid = DOMAINS_SNAPSHOT_CID
  if (!cid) return null
  if (manifestCid !== cid) {
    manifestPromise = null
    shardCache.clear()
    manifestCid = cid
  }
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const bytes = await lookupPreimage(cid)
      if (!bytes) return null
      try {
        const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
        if (!isManifest(json) || json.network !== ASSETHUB_GENESIS) return null
        return json
      } catch {
        return null
      }
    })()
    void manifestPromise.then((m) => {
      if (!m) manifestPromise = null
    })
  }
  return manifestPromise
}

function loadShard(cid: string): Promise<string[]> {
  const cached = shardCache.get(cid)
  if (cached) return cached
  const promise = (async () => {
    const bytes = await lookupPreimage(cid)
    if (!bytes) throw new Error(`shard preimage unavailable: ${cid}`)
    const text = await gunzip(bytes)
    return text.split('\n').filter((line) => line.length > 0)
  })()
  promise.catch(() => shardCache.delete(cid))
  shardCache.set(cid, promise)
  return promise
}

function lowerBound(sorted: string[], prefix: string): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid]! < prefix) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Prefix-match bare `.dot` labels from the verifiable snapshot. `prefix` must be
 * normalized (lowercased, `.dot`-stripped). Returns sorted labels, or `[]` on any
 * error, abort, or when no snapshot is configured.
 */
export async function suggestNames(prefix: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const manifest = await loadManifest()
    if (!manifest || signal?.aborted) return []

    const entry = manifest.shards[prefix.slice(0, manifest.shardScheme.prefixLen)]
    if (!entry) return []

    const labels = await loadShard(entry.cid)
    if (signal?.aborted) return []

    const start = lowerBound(labels, prefix)
    const out: string[] = []
    for (let i = start; i < labels.length && out.length < MAX_SUGGESTIONS; i++) {
      if (!labels[i]!.startsWith(prefix)) break
      out.push(labels[i]!)
    }
    return out
  } catch {
    return []
  }
}
