/**
 * Deterministic domains snapshot fixture for the suggestion tests.
 *
 * The playwright config computes `APP_DOMAINS_SNAPSHOT_CID` from these bytes
 * and the specs seed the same bytes into the host preimage store, so the two
 * stay in lockstep without a pinned constant.
 */

import { gzipSync } from 'node:zlib'

import { blake2b } from '@noble/hashes/blake2b'

/** Labels the suggestion specs type against. Sorted, two character shards. */
export const SNAPSHOT_LABELS = ['browse', 'myapp', 'mydomain']

const CIDV1_RAW_BLAKE2B_PREFIX = Uint8Array.from([0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20])
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** Encode a blake2b-256 digest as the base32 `CIDv1(raw, blake2b-256)` the app resolves. */
function digestToCid(digest: Uint8Array): string {
  const bytes = [...CIDV1_RAW_BLAKE2B_PREFIX, ...digest]
  let bits = 0
  let buf = 0
  let out = 'b'
  for (const byte of bytes) {
    buf = (buf << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += BASE32_ALPHABET[(buf >> bits) & 31]
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buf << (5 - bits)) & 31]
  return out
}

export interface SnapshotFixture {
  manifestBytes: Uint8Array
  manifestCid: string
  shardBytes: Record<string, Uint8Array>
}

/**
 * Build the snapshot bytes for a network genesis.
 *
 * The manifest embeds the genesis because the app rejects a snapshot built
 * for another network.
 */
export function buildSnapshotFixture(network: string): SnapshotFixture {
  const sorted = [...SNAPSHOT_LABELS].sort()
  const byPrefix = new Map<string, string[]>()
  for (const label of sorted) {
    const prefix = label.slice(0, 2)
    const list = byPrefix.get(prefix) ?? []
    list.push(label)
    byPrefix.set(prefix, list)
  }

  const shardBytes: Record<string, Uint8Array> = {}
  const shards: Record<string, { cid: string; count: number }> = {}
  for (const [prefix, list] of byPrefix) {
    const gzipped = new Uint8Array(gzipSync(Buffer.from(list.join('\n'), 'utf8')))
    shardBytes[prefix] = gzipped
    shards[prefix] = { cid: digestToCid(blake2b(gzipped, { dkLen: 32 })), count: list.length }
  }

  const manifest = {
    version: 1,
    generatedAt: 0,
    network,
    shardScheme: { prefixLen: 2, count: Object.keys(shards).length },
    shards
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  return {
    manifestBytes,
    manifestCid: digestToCid(blake2b(manifestBytes, { dkLen: 32 })),
    shardBytes
  }
}
