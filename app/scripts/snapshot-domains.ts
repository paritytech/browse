/**
 * Build and publish the daily Dotns domains snapshot.
 *
 *   cd app && MNEMONIC="…" bun scripts/snapshot-domains.ts [paseo|previewnet]
 */

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
  type MulticallTarget,
  namehash,
  selectNetwork,
  tryDecode
} from '@parity/browse-sdk'
import { getWsProvider } from 'polkadot-api/ws'

import { BULLETIN_RPC_BY_GENESIS, publishSnapshot, resolveGenesis, shardKey } from './lib/snapshot'

const SNAPSHOT_VERSION = 1
const STORE_FACTORY_PAGE_LIMIT = 1000n
const LABEL_STORE_PAGE_LIMIT = 1000n
const CONTENT_CHUNK = 200
/** SS58 padding-derived dummy origin (H160 zero) for unauthenticated reads. */
const DUMMY_ORIGIN = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1'

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

async function main(): Promise<void> {
  const mnemonic = process.env.MNEMONIC
  if (!mnemonic) {
    console.error('MNEMONIC env is required to publish the snapshot')
    process.exit(1)
  }
  const genesis = resolveGenesis()
  const network = selectNetwork(genesis)
  const bulletinRpc = BULLETIN_RPC_BY_GENESIS[genesis]
  if (!bulletinRpc) {
    console.error(`No Bulletin RPC configured for network ${genesis}`)
    process.exit(1)
  }

  console.log(`network:   ${genesis}`)
  console.log(`rpc:       ${network.ASSETHUB_RPCS[0]}`)
  console.log(`bulletin:  ${bulletinRpc}\n`)

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

  const { manifestCid, shardCount } = await publishSnapshot({
    version: SNAPSHOT_VERSION,
    genesis,
    bulletinRpc,
    mnemonic,
    lines: labels,
    shardKeyOf: shardKey
  })

  console.log(`\nPublished ${labels.length} domains in ${shardCount} shards.`)
  console.log(`\nAPP_DOMAINS_SNAPSHOT_CID=${manifestCid}`)
}

await main()
