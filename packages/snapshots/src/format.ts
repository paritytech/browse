// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 	http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Wire format of a verifiable snapshot, shared by the reader and the publisher.
 *
 * A snapshot is a set of gzipped blocks. One block per shard holds the sorted
 * lines whose sort key starts with that shard prefix. One manifest block lists
 * every shard block by CID. Every block is addressed as
 * `CIDv1(raw, blake2b-256)`, which is how Bulletin stores it, so the CID is also
 * the integrity check. A reader that gets bytes back for a CID knows they hash
 * to it.
 *
 * Keeping both directions in one module is deliberate. The publisher and the
 * reader have to agree byte for byte on sharding, compression, and content
 * addressing, and two copies of that agreement drift.
 */

import { blake2b } from '@noble/hashes/blake2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/** Multicodec identifier for raw bytes. */
export const RAW_CODEC = 0x55

/** Multihash identifier for blake2b-256. */
export const BLAKE2B_256 = 0xb220

/** Prefix bytes of a `CIDv1(raw, blake2b-256, 32-byte digest)`. */
const CID_PREFIX = new Uint8Array([0x01, 0x55, 0xa0, 0xe4, 0x02, 0x20])

const DIGEST_BYTES = 32

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/**
 * Leading characters of the sort key that select a shard.
 *
 * Doubles as the shortest prefix worth searching. Anything shorter cannot pick a
 * shard, so there is nothing to look in.
 */
export const MIN_PREFIX_LENGTH = 2

/** Manifest block contents, the contract between the publisher and the reader. */
export interface SnapshotManifest {
  version: number
  /** Unix milliseconds at which the crawl was published. */
  generatedAt: number
  /** Genesis hash the snapshot was crawled against. */
  network: string
  shardScheme: { prefixLen: number; count: number }
  /** Shard block CID and entry count, keyed by shard prefix. */
  shards: Record<string, { cid: string; count: number }>
}

function base32Decode(value: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let buffer = 0
  for (const char of value) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`)
    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let buffer = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += BASE32_ALPHABET[(buffer >> bits) & 31]
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return out
}

/**
 * Decode a base32 CIDv1 to its blake2b-256 digest, the key a block is looked up
 * by.
 *
 * Throws when the CID is not `CIDv1(raw, blake2b-256, 32-byte digest)`. A legacy
 * sha-256 CID lands here, so callers that accept untrusted CIDs should catch.
 */
export function cidToBlake2b256DigestHex(cid: string): `0x${string}` {
  if (!cid.startsWith('b')) {
    throw new Error('CID is not a base32 CIDv1, expected a "b…" multibase prefix')
  }
  const bytes = base32Decode(cid.slice(1))
  if (bytes.length !== CID_PREFIX.length + DIGEST_BYTES) {
    throw new Error(
      `CID decoded to ${bytes.length} bytes, expected ${CID_PREFIX.length + DIGEST_BYTES}`
    )
  }
  for (let i = 0; i < CID_PREFIX.length; i++) {
    if (bytes[i] !== CID_PREFIX[i]) {
      throw new Error(
        `CID is not CIDv1(raw, blake2b-256): byte ${i} is 0x${bytes[i]!.toString(16).padStart(2, '0')}, ` +
          `expected 0x${CID_PREFIX[i]!.toString(16).padStart(2, '0')}`
      )
    }
  }
  return `0x${bytesToHex(bytes.slice(CID_PREFIX.length))}`
}

/** Render a blake2b-256 digest as the base32 `CIDv1(raw, blake2b-256)` string. */
export function digestToCid(digest: Uint8Array): string {
  if (digest.length !== DIGEST_BYTES) {
    throw new Error(`Digest must be ${DIGEST_BYTES} bytes, got ${digest.length}`)
  }
  const bytes = new Uint8Array(CID_PREFIX.length + DIGEST_BYTES)
  bytes.set(CID_PREFIX, 0)
  bytes.set(digest, CID_PREFIX.length)
  return `b${base32Encode(bytes)}`
}

/** Content address of a block, the identifier the reader resolves it by. */
export function blockCid(bytes: Uint8Array): string {
  return digestToCid(blake2b(bytes, { dkLen: DIGEST_BYTES }))
}

/**
 * Shard a sort key belongs to, or `null` when it is too short to have one.
 *
 * A reader cannot ask for a prefix shorter than {@link MIN_PREFIX_LENGTH}, so a
 * shorter key has no shard that could ever be selected. The publisher drops
 * those lines rather than paying to store a block nothing can read.
 */
export function shardKey(sortKey: string): string | null {
  return sortKey.length >= MIN_PREFIX_LENGTH ? sortKey.slice(0, MIN_PREFIX_LENGTH) : null
}

/** Decompress gzip bytes to UTF-8 text. */
export async function gunzip(bytes: Uint8Array): Promise<string> {
  // Copy into a standalone ArrayBuffer. A Uint8Array can be a view into a larger
  // buffer, and naming the DOM-only BufferSource type here would force every
  // consumer of this package to compile with the DOM lib.
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/**
 * Index of the first entry whose sort key is greater than or equal to `prefix`.
 *
 * Standard lower bound over a sorted array. The caller walks forward from here
 * while entries still start with the prefix.
 */
export function lowerBound<T>(
  sorted: readonly T[],
  prefix: string,
  sortKeyOf: (entry: T) => string
): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (sortKeyOf(sorted[mid]!) < prefix) low = mid + 1
    else high = mid
  }
  return low
}

/** Whether a parsed value has the shape of a {@link SnapshotManifest}. */
export function isSnapshotManifest(value: unknown): value is SnapshotManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Record<string, unknown>
  return (
    typeof manifest.version === 'number' &&
    typeof manifest.network === 'string' &&
    !!manifest.shardScheme &&
    typeof manifest.shardScheme === 'object' &&
    !!manifest.shards &&
    typeof manifest.shards === 'object'
  )
}

/** Parse manifest bytes, or `null` when they are not a manifest for `network`. */
export function parseManifest(bytes: Uint8Array, network: string): SnapshotManifest | null {
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!isSnapshotManifest(json) || json.network !== network) return null
    return json
  } catch {
    return null
  }
}
