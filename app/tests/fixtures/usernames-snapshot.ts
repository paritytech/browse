/**
 * Minimal published username snapshot for e2e, one shard block plus the manifest
 * block, matching the contract in `scripts/snapshot-usernames.ts`.
 *
 * The dev server bakes `USERNAMES_SNAPSHOT_CID` in as `APP_USERNAMES_SNAPSHOT_CID`
 * through playwright.config.ts. A test seeds `USERNAME_SNAPSHOT_BLOCKS` into the
 * host preimage map so the client lookups resolve, then a username prefix
 * surfaces `SNAPSHOT_USERNAME` as an autocomplete option.
 */

import { gzipSync } from 'node:zlib'

import { blake2b } from '@noble/hashes/blake2.js'
import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'

// Content addressing shared with the crawler: raw codec and blake2b-256.
const RAW_CODEC = 0x55
const BLAKE2B_256 = 0xb220

// Previewnet genesis the e2e suite runs against. The manifest `network` field
// must match the active genesis or the snapshot is rejected.
const PREVIEWNET_GENESIS = '0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb'

/** A username present only in the snapshot, unregistered on the People chain. */
export const SNAPSHOT_USERNAME = 'zzautoname'

// Owner SS58 the shard line maps the username to, the Charlie dev account.
const OWNER = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y'

function blockCid(bytes: Uint8Array): string {
  const digest = Digest.create(BLAKE2B_256, blake2b(bytes, { dkLen: 32 }))
  return CID.createV1(RAW_CODEC, digest).toString()
}

const shardLines = [`${SNAPSHOT_USERNAME}\t${OWNER}`, `zzsecond\t${OWNER}`].sort()
const shardBytes = new Uint8Array(gzipSync(Buffer.from(shardLines.join('\n') + '\n', 'utf8')))
const shardCid = blockCid(shardBytes)

const manifestBytes = new TextEncoder().encode(
  JSON.stringify({
    version: 1,
    generatedAt: 0,
    network: PREVIEWNET_GENESIS,
    shardScheme: { prefixLen: 2, count: 1 },
    shards: { zz: { cid: shardCid, count: shardLines.length } }
  })
)

/** Manifest-block CID, wired into the dev server as `APP_USERNAMES_SNAPSHOT_CID`. */
export const USERNAMES_SNAPSHOT_CID = blockCid(manifestBytes)

/** Shard and manifest blocks to seed into the host preimage map, in any order. */
export const USERNAME_SNAPSHOT_BLOCKS: Uint8Array[] = [shardBytes, manifestBytes]
