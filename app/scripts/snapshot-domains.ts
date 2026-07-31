/**
 * Build and publish the daily Dotns domains snapshot.
 *
 *   cd app && MNEMONIC="…" APP_DOTNS_DOMAIN="…" bun run snapshot:domains:paseo
 */

import { DOMAINS_POINTER_KEY, shardKey } from '@parity/browse-sdk/snapshots'
import { crawlDomains } from '@parity/browse-sdk/crawl'
import { publishSnapshot, writeSnapshotPointer } from '@parity/browse-sdk/snapshots/publish'
import { createBrowseSdk, isKnownGenesis, selectNetwork } from '@parity/browse-sdk'
import { getWsProvider } from 'polkadot-api/ws'

const SNAPSHOT_VERSION = 1

async function main(): Promise<void> {
  const mnemonic = process.env.MNEMONIC
  if (!mnemonic) throw new Error('MNEMONIC is required to pay for Bulletin storage')

  const pointerDomain = process.env.APP_DOTNS_DOMAIN
  if (!pointerDomain) throw new Error('APP_DOTNS_DOMAIN is required to record the pointer')

  const genesis = process.env.NETWORK_GENESIS_HASH
  if (!genesis || !isKnownGenesis(genesis)) {
    throw new Error(`NETWORK_GENESIS_HASH must be a known genesis, got ${genesis ?? 'nothing'}`)
  }

  const network = selectNetwork(genesis)
  const bulletinRpc = network.BULLETIN_RPCS?.[0]
  if (!bulletinRpc) throw new Error(`No Bulletin RPC configured for network ${genesis}`)
  const assetHubRpc = network.ASSETHUB_RPCS[0]!

  console.log(`network:   ${genesis}`)
  console.log(`rpc:       ${assetHubRpc}`)
  console.log(`bulletin:  ${bulletinRpc}\n`)

  const sdk = createBrowseSdk(network, getWsProvider(assetHubRpc))
  let labels: string[]
  try {
    labels = await crawlDomains(sdk, (message) => console.log(message))
  } finally {
    sdk.destroy()
  }
  console.log(`\nCollected ${labels.length} live domain(s)`)

  const { manifestCid, shardCount } = await publishSnapshot({
    version: SNAPSHOT_VERSION,
    genesis,
    bulletinRpc,
    mnemonic,
    lines: labels,
    shardKeyOf: shardKey,
    progress: (message) => console.log(message)
  })
  console.log(`\nPublished ${labels.length} domains in ${shardCount} shards.`)
  // Emit the CID before the pointer write. The blocks are already stored and
  // paid for, and a manifest embeds its own generatedAt, so a CID lost to a
  // failed record write cannot be reproduced without a full re-crawl.
  console.log(`\nAPP_DOMAINS_SNAPSHOT_CID=${manifestCid}`)

  await writeSnapshotPointer({
    assetHubRpc,
    contentResolver: network.CONTENT_RESOLVER,
    domain: pointerDomain,
    key: DOMAINS_POINTER_KEY,
    cid: manifestCid,
    mnemonic,
    progress: (message) => console.log(message)
  })
}

await main()
