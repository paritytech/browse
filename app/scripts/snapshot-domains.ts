/**
 * Build and publish the daily Dotns domains snapshot.
 *
 *   cd app && MNEMONIC="…" bun scripts/snapshot-domains.ts [paseo|previewnet]
 */

import { gzipSync } from 'node:zlib'

import { blake2b } from '@noble/hashes/blake2.js'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers'
import {
  createBrowseSdk,
  decodeAddress,
  decodeAddressArray,
  decodeBytes,
  decodeIpfsContenthash,
  decodeStringArray,
  encodeContenthash,
  encodeGetLabels,
  encodeGetLabelStores,
  encodeOwner,
  isKnownGenesis,
  type MulticallTarget,
  namehash,
  type NetworkGenesis,
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS,
  selectNetwork,
  SUMMIT_ASSETHUB_GENESIS,
  tryDecode
} from '@parity/browse-sdk'
import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import { Binary, createClient, Enum } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'

const SNAPSHOT_VERSION = 1
const STORE_FACTORY_PAGE_LIMIT = 1000n
const LABEL_STORE_PAGE_LIMIT = 1000n
const CONTENT_CHUNK = 200
/** SS58 padding-derived dummy origin (H160 zero) for unauthenticated reads. */
const DUMMY_ORIGIN = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1'

// Bulletin content addressing: raw codec and blake2b-256, matching the host
// preimage bridge (icon CIDs use the same shape).
const RAW_CODEC = 0x55
const BLAKE2B_256 = 0xb220

const BULLETIN_RPC = process.env.BULLETIN_RPC ?? 'wss://paseo-bulletin-next-rpc.polkadot.io'
const POOL_SIZE = 10
const POOL_PREFIX = '//deploy'

const GENESIS_BY_ALIAS: Record<string, NetworkGenesis> = {
  paseo: PASEO_ASSETHUB_NEXT_V2_GENESIS,
  'paseo-next-v2': PASEO_ASSETHUB_NEXT_V2_GENESIS,
  previewnet: PREVIEWNET_ASSETHUB_GENESIS,
  preview: PREVIEWNET_ASSETHUB_GENESIS,
  summit: SUMMIT_ASSETHUB_GENESIS
}

function resolveGenesis(): NetworkGenesis {
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

/** Strip a trailing `.dot`, lowercase, reject subnames (interior `.`). */
function normalizeLabel(raw: string): string | null {
  if (!raw) return null
  const bare = (raw.endsWith('.dot') ? raw.slice(0, -4) : raw).toLowerCase()
  if (!bare || bare.includes('.')) return null
  return bare
}

/** Map an H160 to its owning SS58 account via Revive.OriginalAccount. */
async function lookupOriginalAccount(
  sdk: ReturnType<typeof createBrowseSdk>,
  h160: string
): Promise<string | null> {
  try {
    const api = sdk.getClient().getUnsafeApi()
    const h160Hex = (h160.startsWith('0x') ? h160 : `0x${h160}`) as `0x${string}`
    const mapped = await api.query.Revive.OriginalAccount.getValue(h160Hex)
    return (mapped as { toString?: () => string } | undefined)?.toString?.() ?? null
  } catch {
    return null
  }
}

/** Enumerate every label via StoreFactory.getLabelStores then LabelStore.getLabels. */
async function crawlViaStores(sdk: ReturnType<typeof createBrowseSdk>): Promise<string[]> {
  const network = sdk.network
  const storeAddresses: `0x${string}`[] = []
  for (let offset = 0n; ; offset += STORE_FACTORY_PAGE_LIMIT) {
    const raw = await sdk.reviveCall(
      network.STORE_FACTORY,
      encodeGetLabelStores(offset, STORE_FACTORY_PAGE_LIMIT)
    )
    const page = decodeAddressArray(raw)
    for (const addr of page) storeAddresses.push(addr.toLowerCase() as `0x${string}`)
    if (page.length < Number(STORE_FACTORY_PAGE_LIMIT)) break
  }
  console.log(`stores:    ${storeAddresses.length} LabelStore(s)`)
  if (storeAddresses.length === 0) return []

  const ownerResults = await sdk.multicall(
    storeAddresses.map((addr) => ({ target: addr, callData: encodeOwner() }))
  )
  const ownerH160s = ownerResults.map((r) => tryDecode(r, (d) => decodeAddress(d).toLowerCase()))

  const seen = new Set<string>()
  let scanned = 0
  for (let i = 0; i < storeAddresses.length; i++) {
    const ownerSS58 = ownerH160s[i] ? await lookupOriginalAccount(sdk, ownerH160s[i]!) : null
    const origin = ownerSS58 ?? DUMMY_ORIGIN
    for (let offset = 0n; ; offset += LABEL_STORE_PAGE_LIMIT) {
      let page: string[]
      try {
        const raw = await sdk.reviveCall(
          storeAddresses[i]!,
          encodeGetLabels(offset, LABEL_STORE_PAGE_LIMIT),
          origin
        )
        page = decodeStringArray(raw)
      } catch {
        break
      }
      for (const rawLabel of page) {
        const bare = normalizeLabel(rawLabel)
        if (bare) seen.add(bare)
      }
      if (page.length < Number(LABEL_STORE_PAGE_LIMIT)) break
    }
    scanned++
    if (scanned % 50 === 0 || scanned === storeAddresses.length) {
      console.log(`  scanned ${scanned}/${storeAddresses.length} stores, ${seen.size} labels`)
    }
  }
  return [...seen]
}

/** Keep only labels whose `.dot` node has a content hash (resolve to content). */
async function filterToLive(
  sdk: ReturnType<typeof createBrowseSdk>,
  labels: string[]
): Promise<string[]> {
  const network = sdk.network
  const live: string[] = []
  for (let i = 0; i < labels.length; i += CONTENT_CHUNK) {
    const batch = labels.slice(i, i + CONTENT_CHUNK)
    const calls: MulticallTarget[] = batch.map((label) => ({
      target: network.CONTENT_RESOLVER,
      callData: encodeContenthash(namehash(`${label}.dot`))
    }))
    const results = await sdk.multicall(calls)
    batch.forEach((label, j) => {
      const cid = tryDecode(results[j], (d) => decodeIpfsContenthash(decodeBytes(d)))
      if (cid) live.push(label)
    })
    console.log(
      `  content-checked ${Math.min(i + CONTENT_CHUNK, labels.length)}/${labels.length}, ${live.length} live`
    )
  }
  return live
}

function shardKey(label: string): string {
  return label.length >= 2 ? label.slice(0, 2) : '_short'
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
async function storeBlocks(mnemonic: string, blocks: Block[]): Promise<void> {
  const client = createClient(getWsProvider(BULLETIN_RPC))
  const api = client.getUnsafeApi()
  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)))

  // Pool-aware next nonce that accounts for in-flight pool txs. papi reads
  // finalized, so use the @polkadot/api `system_accountNextIndex` RPC.
  const pjs = await ApiPromise.create({ provider: new WsProvider(BULLETIN_RPC), noInitWarn: true })
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

async function main(): Promise<void> {
  const mnemonic = process.env.MNEMONIC
  if (!mnemonic) {
    console.error('MNEMONIC env is required to publish the snapshot')
    process.exit(1)
  }
  const genesis = resolveGenesis()
  const network = selectNetwork(genesis)

  console.log(`network:   ${genesis}`)
  console.log(`rpc:       ${network.ASSETHUB_RPCS[0]}\n`)

  const sdk = createBrowseSdk(network, getWsProvider(network.ASSETHUB_RPCS[0]!))

  let labels: string[]
  try {
    labels = await crawlViaStores(sdk)
    console.log(`\nfiltering ${labels.length} labels to those with a content hash…`)
    labels = await filterToLive(sdk, labels)
  } finally {
    sdk.destroy()
  }

  labels = labels.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  console.log(`\nCollected ${labels.length} live domain(s)`)

  // Shard, gzip, and content-address each shard.
  const buckets = new Map<string, string[]>()
  for (const label of labels) {
    const key = shardKey(label)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(label)
    else buckets.set(key, [label])
  }

  const shards: Record<string, { cid: string; count: number }> = {}
  const blocks: Block[] = []
  for (const [key, bucketLabels] of buckets) {
    const gzipped = new Uint8Array(gzipSync(Buffer.from(bucketLabels.join('\n') + '\n', 'utf8')))
    const cid = blockCid(gzipped)
    shards[key] = { cid: cid.toString(), count: bucketLabels.length }
    blocks.push({ cid, data: gzipped })
  }

  const manifestBytes = new TextEncoder().encode(
    JSON.stringify({
      version: SNAPSHOT_VERSION,
      generatedAt: Date.now(),
      network: genesis,
      shardScheme: { prefixLen: 2 as const, count: buckets.size },
      shards
    })
  )
  const manifestCid = blockCid(manifestBytes)
  // Store the manifest last so a partial run never publishes a manifest whose
  // shards aren't all on-chain yet.
  blocks.push({ cid: manifestCid, data: manifestBytes })

  console.log(`blocks:    ${blocks.length} (${buckets.size} shards + manifest)`)
  await storeBlocks(mnemonic, blocks)

  console.log(`\nPublished ${labels.length} domains in ${buckets.size} shards.`)
  console.log(`\nAPP_DOMAINS_SNAPSHOT_CID=${manifestCid.toString()}`)
}

await main()
