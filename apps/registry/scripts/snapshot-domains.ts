/**
 * Build and publish the daily Dotns domains snapshot, then point the name at it.
 *
 *   cd app && MNEMONIC="…" bun run snapshot:domains:paseo
 *
 * Crawling and publishing cost a full pass over the chain and real Bulletin
 * storage, while repointing costs one transaction. Pass `--cid` to skip straight
 * to the record write with a snapshot that is already published, and `--dry-run`
 * to stop at the check that the key may write the record.
 */

import { createBrowseSdk, isKnownGenesis, selectNetwork } from '@parity/browse-sdk'
import {
  crawlDomains,
  DOMAINS_POINTER_KEY,
  publishSnapshot,
  shardKey,
  updateSnapshotPointer
} from '@parity/browse-sdk/snapshots'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'

import { ASSETHUB_DESCRIPTOR_BY_GENESIS } from '../src/lib/client'

const SNAPSHOT_VERSION = 1

/** Value of a `--name value` or `--name=value` flag. */
function flag(name: string): string | undefined {
  const argv = process.argv.slice(2)
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const publishedCid = flag('cid')

  const mnemonic = process.env.MNEMONIC
  if (!mnemonic) throw new Error('MNEMONIC is required to pay for Bulletin storage')

  const genesis = process.env.NETWORK_GENESIS_HASH
  if (!genesis || !isKnownGenesis(genesis)) {
    throw new Error(`NETWORK_GENESIS_HASH must be a known genesis, got ${genesis ?? 'nothing'}`)
  }

  const network = selectNetwork(genesis)
  const pointerDomain = network.SNAPSHOT_POINTER_DOMAIN
  const assetHubRpc = network.ASSETHUB_RPCS[0]!

  console.log(`network:   ${genesis}`)
  console.log(`rpc:       ${assetHubRpc}`)

  let manifestCid = publishedCid
  if (!manifestCid) {
    const bulletinRpc = network.BULLETIN_RPCS?.[0]
    if (!bulletinRpc) throw new Error(`No Bulletin RPC configured for network ${genesis}`)
    console.log(`bulletin:  ${bulletinRpc}\n`)

    const sdk = createBrowseSdk(network, getWsProvider(assetHubRpc))
    let labels: string[]
    try {
      labels = await crawlDomains(sdk, (message) => console.log(message))
    } finally {
      sdk.destroy()
    }
    console.log(`\nCollected ${labels.length} live domain(s)`)

    const published = await publishSnapshot({
      version: SNAPSHOT_VERSION,
      genesis,
      bulletinRpc,
      mnemonic,
      lines: labels,
      shardKeyOf: shardKey,
      progress: (message) => console.log(message)
    })
    manifestCid = published.manifestCid
    console.log(`\nPublished ${labels.length} domains in ${published.shardCount} shards.`)
    // Emit the CID before the pointer write. The blocks are already stored and
    // paid for, and a manifest embeds its own generatedAt, so a CID lost to a
    // failed record write cannot be reproduced without a full re-crawl. Feed it
    // back with `--cid` rather than crawling again.
    console.log(`\nAPP_DOMAINS_SNAPSHOT_CID=${manifestCid}`)
  }

  const client = createClient(getWsProvider(assetHubRpc))
  try {
    await updateSnapshotPointer({
      api: client.getTypedApi(ASSETHUB_DESCRIPTOR_BY_GENESIS[genesis]),
      contentResolver: network.CONTENT_RESOLVER,
      domain: pointerDomain,
      key: DOMAINS_POINTER_KEY,
      cid: manifestCid,
      mnemonic,
      dryRun,
      progress: (message) => console.log(message)
    })
  } finally {
    client.destroy()
  }
  if (dryRun) console.log('\nDry run only, the record was not written.')
}

await main()
