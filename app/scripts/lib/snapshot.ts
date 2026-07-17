/**
 * Shared pipeline for the daily verifiable snapshots.
 *
 * A snapshot publishes one gzipped block per 2-char prefix shard of sorted
 * lines, plus a `manifest` block listing every shard CID. Every block is a
 * `CIDv1(raw, blake2b-256)`, the shape the host preimage bridge resolves.
 * Callers supply the sorted lines and a shard-key function. This module handles
 * sharding, gzip, content-addressing, and Bulletin publishing.
 */

import { gzipSync } from 'node:zlib'

import { blake2b } from '@noble/hashes/blake2.js'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers'
import {
  isKnownGenesis,
  type NetworkGenesis,
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS,
  SUMMIT_ASSETHUB_GENESIS
} from '@parity/browse-sdk'
import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import { Binary, createClient, Enum } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'

// Bulletin content addressing: raw codec and blake2b-256, matching the host
// preimage bridge. Icon CIDs use the same shape.
const RAW_CODEC = 0x55
const BLAKE2B_256 = 0xb220

const POOL_SIZE = 10
const POOL_PREFIX = '//deploy'

/** Bulletin RPC per network, keyed by the resolved genesis. */
export const BULLETIN_RPC_BY_GENESIS: Partial<Record<NetworkGenesis, string>> = {
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: 'wss://paseo-bulletin-next-rpc.polkadot.io',
  [PREVIEWNET_ASSETHUB_GENESIS]: 'wss://previewnet.substrate.dev/bulletin'
}

const GENESIS_BY_ALIAS: Record<string, NetworkGenesis> = {
  paseo: PASEO_ASSETHUB_NEXT_V2_GENESIS,
  'paseo-next-v2': PASEO_ASSETHUB_NEXT_V2_GENESIS,
  previewnet: PREVIEWNET_ASSETHUB_GENESIS,
  preview: PREVIEWNET_ASSETHUB_GENESIS,
  summit: SUMMIT_ASSETHUB_GENESIS
}

/** Resolve the target genesis from `NETWORK_GENESIS_HASH` or the CLI alias. */
export function resolveGenesis(): NetworkGenesis {
  const envGenesis = process.env.NETWORK_GENESIS_HASH
  if (envGenesis) {
    if (!isKnownGenesis(envGenesis)) {
      console.error(`Unknown NETWORK_GENESIS_HASH: ${envGenesis}`)
      process.exit(1)
    }
    return envGenesis
  }
  const alias = (process.argv[2] ?? 'paseo').toLowerCase()
  const genesis = GENESIS_BY_ALIAS[alias]
  if (!genesis) {
    console.error(
      `Unknown network alias '${alias}'. Use: ${Object.keys(GENESIS_BY_ALIAS).join(', ')}`
    )
    process.exit(1)
  }
  return genesis
}

/** 2-char prefix shard key, matching the `shardScheme.prefixLen` the client reads. */
export function shardKey(sortKey: string): string {
  return sortKey.length >= 2 ? sortKey.slice(0, 2) : '_short'
}

/** `CIDv1(raw, blake2b-256)` of a block, the shape the host preimage bridge resolves. */
function blockCid(bytes: Uint8Array): CID {
  return CID.createV1(RAW_CODEC, Digest.create(BLAKE2B_256, blake2b(bytes, { dkLen: 32 })))
}

interface Block {
  cid: CID
  data: Uint8Array
}

/**
 * Store every block on Bulletin, draining each pool account sequentially with
 * all accounts in parallel.
 *
 * Each account confirms a nonce by block inclusion before advancing. A stale
 * nonce is retried after re-reading the pool-aware next index.
 */
async function storeBlocks(mnemonic: string, blocks: Block[], bulletinRpc: string): Promise<void> {
  const client = createClient(getWsProvider(bulletinRpc))
  const api = client.getUnsafeApi()
  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)))

  // Pool-aware next nonce that accounts for in-flight pool txs. papi reads
  // finalized, so use the @polkadot/api `system_accountNextIndex` RPC.
  const pjs = await ApiPromise.create({ provider: new WsProvider(bulletinRpc), noInitWarn: true })
  const pool = await Promise.all(
    Array.from({ length: POOL_SIZE }, async (_, i) => {
      const kp = derive(`${POOL_PREFIX}/${i}`)
      const address = ss58Address(kp.publicKey)
      return {
        signer: getPolkadotSigner(kp.publicKey, 'Sr25519', kp.sign),
        address,
        nonce: (await pjs.rpc.system.accountNextIndex(address)).toNumber()
      }
    })
  )
  console.log(`pool:      ${POOL_SIZE} signers (${pool[0]!.address.slice(0, 8)}…)\n`)

  const submit = (b: Block, signer: ReturnType<typeof getPolkadotSigner>, nonce: number) =>
    new Promise<void>((resolve, reject) => {
      const tx = api.tx.TransactionStorage.store_with_cid_config({
        cid: { codec: BigInt(RAW_CODEC), hashing: Enum('Blake2b256') },
        data: Binary.fromHex(`0x${Buffer.from(b.data).toString('hex')}`)
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = tx
        .signSubmitAndWatch(signer, { mortality: { mortal: true, period: 64 }, nonce })
        .subscribe({
          next: (e: any) => {
            if (e.type === 'txBestBlocksState' && e.found) {
              sub.unsubscribe()
              if (e.ok) resolve()
              else reject(new Error('tx failed in block'))
            }
          },
          error: (err: unknown) => reject(err)
        })
    })

  const isStale = (e: unknown) => JSON.stringify((e as Error)?.message ?? e ?? '').includes('Stale')

  let done = 0
  await Promise.all(
    pool.map(async (acct, ai) => {
      let nonce = acct.nonce
      for (let idx = ai; idx < blocks.length; idx += POOL_SIZE) {
        for (let attempt = 0; ; attempt++) {
          try {
            await submit(blocks[idx]!, acct.signer, nonce)
            nonce++
            break
          } catch (e) {
            if (isStale(e) && attempt < 8) {
              nonce = (await pjs.rpc.system.accountNextIndex(acct.address)).toNumber()
              continue
            }
            throw e
          }
        }
        done++
        if (done % 50 === 0 || done === blocks.length)
          console.log(`  stored ${done}/${blocks.length}`)
      }
    })
  )

  await pjs.disconnect()
  client.destroy()
}

export interface PublishResult {
  manifestCid: string
  shardCount: number
}

/**
 * Shard `lines` by `shardKeyOf`, gzip each shard, content-address it, and publish
 * the shard blocks and a manifest block to Bulletin. `lines` must already be
 * sorted. Returns the manifest block CID and the shard count.
 */
export async function publishSnapshot(opts: {
  version: number
  genesis: NetworkGenesis
  bulletinRpc: string
  mnemonic: string
  lines: string[]
  shardKeyOf: (line: string) => string
}): Promise<PublishResult> {
  const { version, genesis, bulletinRpc, mnemonic, lines, shardKeyOf } = opts

  const buckets = new Map<string, string[]>()
  for (const line of lines) {
    const key = shardKeyOf(line)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(line)
    else buckets.set(key, [line])
  }

  const shards: Record<string, { cid: string; count: number }> = {}
  const blocks: Block[] = []
  for (const [key, bucketLines] of buckets) {
    const gzipped = new Uint8Array(gzipSync(Buffer.from(bucketLines.join('\n') + '\n', 'utf8')))
    const cid = blockCid(gzipped)
    shards[key] = { cid: cid.toString(), count: bucketLines.length }
    blocks.push({ cid, data: gzipped })
  }

  const manifestBytes = new TextEncoder().encode(
    JSON.stringify({
      version,
      generatedAt: Date.now(),
      network: genesis,
      shardScheme: { prefixLen: 2 as const, count: buckets.size },
      shards
    })
  )
  const manifestCid = blockCid(manifestBytes)
  // Store the manifest last so a partial run never publishes a manifest whose
  // shards are not all stored yet.
  blocks.push({ cid: manifestCid, data: manifestBytes })

  console.log(`blocks:    ${blocks.length} (${buckets.size} shards + manifest)`)
  await storeBlocks(mnemonic, blocks, bulletinRpc)

  return { manifestCid: manifestCid.toString(), shardCount: buckets.size }
}
