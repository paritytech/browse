/**
 * Verifiable `.dot` (dotNS) domain snapshot, client read path.
 *
 * A daily job (`scripts/snapshot-domains.ts`) publishes to Bulletin one gzipped
 * block per 2-char prefix shard (sorted bare labels, no `.dot`) plus a
 * `manifest` block that lists every shard CID. Every block is a
 * `CIDv1(raw, blake2b-256)`, the same content-addressing the host preimage
 * bridge uses for product icons, so we resolve them with `preimageManager.lookup`
 * (keyed by the blake2b digest) exactly like `useIconBlob`, never over an IPFS
 * gateway. The CID is the integrity check: the host only returns bytes whose
 * blake2b-256 hash matches the key, so no extra SHA-256 is needed.
 *
 * `DOMAINS_SNAPSHOT_CID` is the manifest block CID. Any lookup or decode failure
 * degrades to `[]` so suggestions close. It never throws into render.
 */

import { preimageManager } from '@novasamatech/host-api-wrapper'
import { useQuery } from '@tanstack/react-query'

import { ASSETHUB_GENESIS, DOMAINS_SNAPSHOT_CID } from './config'
import { cidToBlake2b256DigestHex } from '../state/apps/icon'

/** Shape of the manifest block, fixed by the shared contract with the crawler. */
export interface DomainsSnapshotManifest {
  version: number
  generatedAt: number
  /** Genesis hash the snapshot was crawled against. */
  network: string
  shardScheme: { prefixLen: 2; count: number }
  /** Per 2-char prefix: the shard block's CID + label count. */
  shards: Record<string, { cid: string; count: number }>
}

const MIN_PREFIX_LENGTH = 2
const MAX_SUGGESTIONS = 8
const LOOKUP_TIMEOUT_MS = 8_000

/** Resolve the bytes of a `CIDv1(raw, blake2b-256)` block via the host preimage
 * bridge, or `null` if the CID is malformed or the host cannot resolve it. */
function lookupPreimage(cid: string): Promise<Uint8Array | null> {
  let key: `0x${string}`
  try {
    key = cidToBlake2b256DigestHex(cid)
  } catch {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    let done = false
    const settle = (bytes: Uint8Array | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      subscription.unsubscribe()
      resolve(bytes)
    }
    // The host delivers null immediately when it has not yet fetched the bytes,
    // then a later callback once it has them. Ignore that null and wait, exactly
    // like useIconBlob: settle only on real bytes, on interrupt, or on timeout.
    const subscription = preimageManager.lookup(key, (bytes) => {
      if (bytes) settle(new Uint8Array(bytes))
    })
    subscription.onInterrupt(() => settle(null))
    const timer = setTimeout(() => settle(null), LOOKUP_TIMEOUT_MS)
  })
}

/** Gunzip raw gzip bytes to UTF-8 text via the native DecompressionStream. */
async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Response(
    new Blob([bytes as BufferSource]).stream().pipeThrough(new DecompressionStream('gzip'))
  )
  return stream.text()
}

// Per-session caches keyed by the manifest CID so a snapshot rotation (new CID)
// naturally invalidates them. A failed manifest load is NOT cached (memo cleared
// on null) so a transient host hiccup doesn't kill suggestions for the session.
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

/**
 * Load and validate the manifest for the active network. Returns `null` when no
 * snapshot is configured, the manifest can't be resolved/parsed, or its
 * `network` doesn't match the active genesis. Memoized per CID on success only.
 */
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
    // Don't strand the session on a transient failure. Let the next call retry.
    void manifestPromise.then((m) => {
      if (!m) manifestPromise = null
    })
  }
  return manifestPromise
}

/** Fetch, decompress, and cache the sorted label list for a shard, keyed by its
 * immutable CID so concurrent callers share one lookup. Rejects (the caller maps
 * that to `[]`) if the block cannot be resolved. */
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

/** Index of the first element `>= prefix` in a sorted array. */
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
 * Prefix-match bare `.dot` labels from the snapshot. `prefix` is expected to be
 * already normalized (lowercased, `.dot`-stripped) and at least
 * {@link MIN_PREFIX_LENGTH} long. The only caller is {@link useDomainSuggestions},
 * which guarantees both.
 *
 * @param signal optional abort signal (from react-query) to drop a stale result
 * @returns sorted bare labels, or `[]` on any error or abort
 */
async function suggestNames(prefix: string, signal?: AbortSignal): Promise<string[]> {
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

/**
 * Suggest bare `.dot` labels for a search prefix from the verifiable snapshot.
 * Runs only once the (already-normalized) prefix reaches {@link MIN_PREFIX_LENGTH}.
 * Results stay fresh for 60s. Yields `[]` when no snapshot is configured.
 */
export function useDomainSuggestions(prefix: string) {
  return useQuery<string[]>({
    queryKey: ['domainSuggestions', prefix],
    queryFn: ({ signal }) => suggestNames(prefix, signal),
    enabled: prefix.length >= MIN_PREFIX_LENGTH,
    staleTime: 60_000
  })
}
