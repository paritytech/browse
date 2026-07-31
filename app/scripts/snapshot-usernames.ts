/**
 * Build and publish the daily username snapshot.
 *
 *   cd app && MNEMONIC="…" bun scripts/snapshot-usernames.ts [paseo|previewnet]
 */

import { BROWSE_POINTER_DOMAIN, shardKey, USERNAMES_POINTER_KEY } from '@parity/browse-snapshots'
import { crawlUsernames } from '@parity/browse-snapshots/crawl'
import { publishSnapshot, writeSnapshotPointer } from '@parity/browse-snapshots/publish'
import { selectNetwork } from '@parity/browse-sdk'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'

import { pointerDomain, requireEnv, resolveGenesis } from './lib/snapshot'

const SNAPSHOT_VERSION = 1

async function main(): Promise<void> {
  const mnemonic = requireEnv('MNEMONIC')
  const genesis = resolveGenesis()
  const network = selectNetwork(genesis)
  const bulletinRpc = network.BULLETIN_RPCS?.[0]
  const peopleRpc = network.PEOPLE_RPCS?.[0]
  if (!bulletinRpc) {
    console.error(`No Bulletin RPC configured for network ${genesis}`)
    process.exit(1)
  }
  if (!peopleRpc) {
    console.error(`No People chain configured for network ${genesis}`)
    process.exit(1)
  }
  const assetHubRpc = network.ASSETHUB_RPCS[0]!
  const pointer = pointerDomain(BROWSE_POINTER_DOMAIN)

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

  if (pointer) {
    await writeSnapshotPointer({
      assetHubRpc,
      contentResolver: network.CONTENT_RESOLVER,
      domain: pointer,
      key: USERNAMES_POINTER_KEY,
      cid: manifestCid,
      mnemonic,
      progress: (message) => console.log(message)
    })
  } else {
    console.log(`\nSkipped the ${USERNAMES_POINTER_KEY} record.`)
  }
}

await main()
