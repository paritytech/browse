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
 * Turning sorted lines into the blocks a snapshot is made of.
 *
 * Kept apart from the Bulletin submission in `publish.ts` so the shape of a
 * snapshot can be built, and tested, without a chain. The reader tests construct
 * their fixtures with this, which is what stops a reader that only ever passes
 * against bytes the tests invented for themselves.
 *
 * Node only. Compression happens through `node:zlib`, so the byte output stays
 * identical run to run.
 */

import { gzipSync } from 'node:zlib'

import { blockCid, MIN_PREFIX_LENGTH, type SnapshotManifest } from './format.js'

/** One addressed block, ready to store. */
export interface SnapshotBlock {
  cid: string
  data: Uint8Array
}

export interface BuiltSnapshot {
  manifestCid: string
  /** Shard blocks first, the manifest last. */
  blocks: SnapshotBlock[]
  shardCount: number
}

/**
 * Shard, compress, and address `lines`, then describe them in a manifest block.
 *
 * `lines` must already be sorted by the same key `shardKeyOf` reads, or the
 * reader binary search will miss entries.
 *
 * The manifest is the last block, so a caller that stores them in order never
 * advertises shards it has not stored yet.
 */
export function buildSnapshotBlocks(options: {
  version: number
  network: string
  lines: string[]
  shardKeyOf: (line: string) => string | null
  generatedAt: number
}): BuiltSnapshot {
  const { version, network, lines, shardKeyOf, generatedAt } = options

  const buckets = new Map<string, string[]>()
  for (const line of lines) {
    const key = shardKeyOf(line)
    if (key === null) continue
    const bucket = buckets.get(key)
    if (bucket) bucket.push(line)
    else buckets.set(key, [line])
  }

  const shards: SnapshotManifest['shards'] = {}
  const blocks: SnapshotBlock[] = []
  for (const [key, bucketLines] of buckets) {
    const utf8 = new TextEncoder().encode(bucketLines.join('\n') + '\n')
    const gzipped = new Uint8Array(gzipSync(utf8))
    const cid = blockCid(gzipped)
    shards[key] = { cid, count: bucketLines.length }
    blocks.push({ cid, data: gzipped })
  }

  const manifest: SnapshotManifest = {
    version,
    generatedAt,
    network,
    shardScheme: { prefixLen: MIN_PREFIX_LENGTH, count: buckets.size },
    shards
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const manifestCid = blockCid(manifestBytes)
  blocks.push({ cid: manifestCid, data: manifestBytes })

  return { manifestCid, blocks, shardCount: buckets.size }
}
