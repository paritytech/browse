/**
 * Domain-snapshot fixture: a minimal published snapshot (one shard block plus
 * the manifest block) matching the contract in `scripts/snapshot-domains.ts`.
 *
 * The dev server bakes `DOMAINS_SNAPSHOT_CID` in as `APP_DOMAINS_SNAPSHOT_CID`
 * (see playwright.config.ts). A test seeds `SNAPSHOT_BLOCKS` into the host
 * preimage map so the client's lookups resolve, then a search prefix surfaces
 * `SNAPSHOT_ONLY_LABEL` as a product card.
 */

import { gzipSync } from 'node:zlib'

import { blake2b } from '@noble/hashes/blake2.js'
import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'

// Content addressing shared with the crawler: raw codec and blake2b-256.
const RAW_CODEC = 0x55
const BLAKE2B_256 = 0xb220

// Genesis the e2e suite runs against (previewnet). The manifest's `network`
// must match the client's active genesis or the snapshot is rejected.
const PREVIEWNET_GENESIS = '0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb'

/** A `.dot` label present only in the snapshot, in no tab and unresolvable on-chain. */
export const SNAPSHOT_ONLY_LABEL = 'zzautocomplete'

function blockCid(bytes: Uint8Array): string {
  const digest = Digest.create(BLAKE2B_256, blake2b(bytes, { dkLen: 32 }))
  return CID.createV1(RAW_CODEC, digest).toString()
}

const shardLabels = [SNAPSHOT_ONLY_LABEL, 'zzstopwatch'].sort()
const shardBytes = new Uint8Array(gzipSync(Buffer.from(shardLabels.join('\n') + '\n', 'utf8')))
const shardCid = blockCid(shardBytes)

const manifestBytes = new TextEncoder().encode(
  JSON.stringify({
    version: 1,
    generatedAt: 0,
    network: PREVIEWNET_GENESIS,
    shardScheme: { prefixLen: 2, count: 1 },
    shards: { zz: { cid: shardCid, count: shardLabels.length } }
  })
)

/** Manifest-block CID, wired into the dev server as `APP_DOMAINS_SNAPSHOT_CID`. */
export const DOMAINS_SNAPSHOT_CID = blockCid(manifestBytes)

/** Shard and manifest blocks to seed into the host preimage map, in any order. */
export const SNAPSHOT_BLOCKS: Uint8Array[] = [shardBytes, manifestBytes]
