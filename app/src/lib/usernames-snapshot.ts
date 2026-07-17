/**
 * Verifiable username snapshot, client read path.
 *
 * The daily `scripts/snapshot-usernames.ts` job publishes to Bulletin one
 * gzipped block per 2-char prefix shard, plus a `manifest` block listing every
 * shard CID, the same layout as the domains snapshot. Each shard line is
 * `username\taccount` sorted by username, so a prefix match yields both the
 * username to display and the owner account to follow with no live chain read.
 *
 * `USERNAMES_SNAPSHOT_CID` is the manifest block CID. Any lookup or decode
 * failure degrades to `[]` so suggestions close. It never throws into render.
 */

import { preimageManager } from '@novasamatech/host-api-wrapper'
import { useQuery } from '@tanstack/react-query'

import { ASSETHUB_GENESIS, USERNAMES_SNAPSHOT_CID } from './config'
import { cidToBlake2b256DigestHex } from '../state/apps/icon'

/** A username and the SS58 account that owns it, read from the snapshot. */
export interface UsernameEntry {
  username: string
  account: string
}

interface UsernamesSnapshotManifest {
  version: number
  generatedAt: number
  network: string
  shardScheme: { prefixLen: 2; count: number }
  shards: Record<string, { cid: string; count: number }>
}

export const MIN_PREFIX_LENGTH = 2
const MAX_SUGGESTIONS = 8
const LOOKUP_TIMEOUT_MS = 8_000

/** Resolve the bytes of a `CIDv1(raw, blake2b-256)` block via the host preimage
 * bridge, or `null` if the CID is malformed or the host cannot resolve it. The
 * bridge only returns bytes whose blake2b-256 hash matches the key, so the CID
 * is the integrity check. Never read these blocks over an IPFS gateway. */
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

// Per-session caches keyed by the manifest CID, so a new snapshot CID naturally
// invalidates them. Independent of the domains snapshot caches.
let manifestPromise: Promise<UsernamesSnapshotManifest | null> | null = null
let manifestCid: string | undefined
const shardCache = new Map<string, Promise<UsernameEntry[]>>()

function isManifest(value: unknown): value is UsernamesSnapshotManifest {
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

/** Load and validate the manifest for the active network. Memoized per CID on
 * success only, so a transient failure doesn't strand the session. */
async function loadManifest(): Promise<UsernamesSnapshotManifest | null> {
  const cid = USERNAMES_SNAPSHOT_CID
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

/** Fetch, decompress, parse, and cache the `username\taccount` entries for a
 * shard, keyed by its immutable CID so concurrent callers share one lookup. */
function loadShard(cid: string): Promise<UsernameEntry[]> {
  const cached = shardCache.get(cid)
  if (cached) return cached
  const promise = (async () => {
    const bytes = await lookupPreimage(cid)
    if (!bytes) throw new Error(`shard preimage unavailable: ${cid}`)
    const text = await gunzip(bytes)
    const entries: UsernameEntry[] = []
    for (const line of text.split('\n')) {
      const tab = line.indexOf('\t')
      if (tab <= 0) continue
      entries.push({ username: line.slice(0, tab), account: line.slice(tab + 1) })
    }
    return entries
  })()
  promise.catch(() => shardCache.delete(cid))
  shardCache.set(cid, promise)
  return promise
}

/** Index of the first entry whose username is `>= prefix` in a username-sorted array. */
function lowerBound(sorted: UsernameEntry[], prefix: string): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid]!.username < prefix) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Prefix-match usernames from the snapshot. `prefix` is expected to be already
 * normalized, lowercased and `@`-stripped, and at least {@link MIN_PREFIX_LENGTH}
 * long. Returns matching `{ username, account }` entries, or `[]` on any error.
 */
async function suggest(prefix: string, signal?: AbortSignal): Promise<UsernameEntry[]> {
  try {
    const manifest = await loadManifest()
    if (!manifest || signal?.aborted) return []

    const entry = manifest.shards[prefix.slice(0, manifest.shardScheme.prefixLen)]
    if (!entry) return []

    const rows = await loadShard(entry.cid)
    if (signal?.aborted) return []

    const start = lowerBound(rows, prefix)
    const out: UsernameEntry[] = []
    for (let i = start; i < rows.length && out.length < MAX_SUGGESTIONS; i++) {
      if (!rows[i]!.username.startsWith(prefix)) break
      out.push(rows[i]!)
    }
    return out
  } catch {
    return []
  }
}

/**
 * Suggest `{ username, account }` matches for a username prefix from the
 * verifiable snapshot. Runs only once the already-normalized prefix reaches
 * {@link MIN_PREFIX_LENGTH}. Results stay fresh for 60s. Yields `[]` when no
 * snapshot is configured.
 */
export function useUsernameSuggestions(prefix: string) {
  return useQuery<UsernameEntry[]>({
    queryKey: ['usernameSuggestions', prefix],
    queryFn: ({ signal }) => suggest(prefix, signal),
    enabled: prefix.length >= MIN_PREFIX_LENGTH,
    staleTime: 60_000
  })
}
