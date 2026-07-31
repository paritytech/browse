/**
 * Build and publish the daily username snapshot.
 *
 *   cd app && MNEMONIC="…" APP_DOTNS_DOMAIN="…" bun run snapshot:usernames:paseo
 */

import { shardKey, USERNAMES_POINTER_KEY } from '@parity/browse-sdk/snapshots'
import { crawlUsernames } from '@parity/browse-sdk/crawl'
import { publishSnapshot, writeSnapshotPointer } from '@parity/browse-sdk/snapshots/publish'
import { isKnownGenesis, selectNetwork } from '@parity/browse-sdk'
import { createClient } from 'polkadot-api'
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
  const peopleRpc = network.PEOPLE_RPCS?.[0]
  if (!peopleRpc) throw new Error(`No People chain configured for network ${genesis}`)
  const assetHubRpc = network.ASSETHUB_RPCS[0]!

  console.log(`network:   ${genesis}`)
  console.log(`people:    ${peopleRpc}`)
  console.log(`bulletin:  ${bulletinRpc}\n`)

  const client = createClient(getWsProvider(peopleRpc))
  let lines: string[]
  try {
    lines = await crawlUsernames(client)
  } finally {
    client.destroy()
  }
  console.log(`\nCollected ${lines.length} username(s)`)

  const { manifestCid, shardCount } = await publishSnapshot({
    version: SNAPSHOT_VERSION,
    genesis,
    bulletinRpc,
    mnemonic,
    lines,
    shardKeyOf: (line) => shardKey(line.slice(0, line.indexOf('\t'))),
    progress: (message) => console.log(message)
  })
  console.log(`\nPublished ${lines.length} usernames in ${shardCount} shards.`)
  // Emit the CID before the pointer write, for the reason in snapshot-domains.ts.
  console.log(`\nAPP_USERNAMES_SNAPSHOT_CID=${manifestCid}`)

  await writeSnapshotPointer({
    assetHubRpc,
    contentResolver: network.CONTENT_RESOLVER,
    domain: pointerDomain,
    key: USERNAMES_POINTER_KEY,
    cid: manifestCid,
    mnemonic,
    progress: (message) => console.log(message)
  })
}

await main()
