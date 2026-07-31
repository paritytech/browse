/**
 * Build and publish the daily Dotns domains snapshot.
 *
 *   cd app && MNEMONIC="…" bun scripts/snapshot-domains.ts [paseo|previewnet]
 */

import { BROWSE_POINTER_DOMAIN, DOMAINS_POINTER_KEY, shardKey } from '@parity/browse-snapshots'
import { crawlDomains } from '@parity/browse-snapshots/crawl'
import { publishSnapshot, writeSnapshotPointer } from '@parity/browse-snapshots/publish'
import { createBrowseSdk, selectNetwork } from '@parity/browse-sdk'
import { getWsProvider } from 'polkadot-api/ws'

import { pointerDomain, requireEnv, resolveGenesis } from './lib/snapshot'

const SNAPSHOT_VERSION = 1

async function main(): Promise<void> {
  const mnemonic = requireEnv('MNEMONIC')
  const genesis = resolveGenesis()
  const network = selectNetwork(genesis)
  const bulletinRpc = network.BULLETIN_RPCS?.[0]
  if (!bulletinRpc) {
    console.error(`No Bulletin RPC configured for network ${genesis}`)
    process.exit(1)
  }
  const assetHubRpc = network.ASSETHUB_RPCS[0]!
  const pointer = pointerDomain(BROWSE_POINTER_DOMAIN)

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

  if (pointer) {
    await writeSnapshotPointer({
      assetHubRpc,
      contentResolver: network.CONTENT_RESOLVER,
      domain: pointer,
      key: DOMAINS_POINTER_KEY,
      cid: manifestCid,
      mnemonic,
      progress: (message) => console.log(message)
    })
  } else {
    console.log(`\nSkipped the ${DOMAINS_POINTER_KEY} record.`)
  }
}

await main()
