/**
 * Build and publish the daily username snapshot, then point the name at it.
 *
 *   cd app && MNEMONIC="…" APP_DOTNS_DOMAIN="…" bun run snapshot:usernames:paseo
 *
 * Crawling and publishing cost a full pass over the chain and real Bulletin
 * storage, while repointing costs one transaction. Pass `--cid` to skip straight
 * to the record write with a snapshot that is already published, and `--dry-run`
 * to stop at the check that the key may write the record.
 */

import {
  crawlUsernames,
  publishSnapshot,
  shardKey,
  updateSnapshotPointer,
  USERNAMES_POINTER_KEY
} from '@parity/browse-sdk/snapshots'
import { isKnownGenesis, selectNetwork } from '@parity/browse-sdk'
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

  const pointerDomain = process.env.APP_DOTNS_DOMAIN
  if (!pointerDomain) throw new Error('APP_DOTNS_DOMAIN is required to record the pointer')

  const genesis = process.env.NETWORK_GENESIS_HASH
  if (!genesis || !isKnownGenesis(genesis)) {
    throw new Error(`NETWORK_GENESIS_HASH must be a known genesis, got ${genesis ?? 'nothing'}`)
  }

  const network = selectNetwork(genesis)
  const assetHubRpc = network.ASSETHUB_RPCS[0]!

  console.log(`network:   ${genesis}`)

  let manifestCid = publishedCid
  if (!manifestCid) {
    const bulletinRpc = network.BULLETIN_RPCS?.[0]
    if (!bulletinRpc) throw new Error(`No Bulletin RPC configured for network ${genesis}`)
    const peopleRpc = network.PEOPLE_RPCS?.[0]
    if (!peopleRpc) throw new Error(`No People chain configured for network ${genesis}`)
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

    const published = await publishSnapshot({
      version: SNAPSHOT_VERSION,
      genesis,
      bulletinRpc,
      mnemonic,
      lines,
      shardKeyOf: (line) => shardKey(line.slice(0, line.indexOf('\t'))),
      progress: (message) => console.log(message)
    })
    manifestCid = published.manifestCid
    console.log(`\nPublished ${lines.length} usernames in ${published.shardCount} shards.`)
    // Emit the CID before the pointer write, for the reason in snapshot-domains.ts.
    console.log(`\nAPP_USERNAMES_SNAPSHOT_CID=${manifestCid}`)
  }

  const assetHub = createClient(getWsProvider(assetHubRpc))
  try {
    await updateSnapshotPointer({
      api: assetHub.getTypedApi(ASSETHUB_DESCRIPTOR_BY_GENESIS[genesis]),
      contentResolver: network.CONTENT_RESOLVER,
      domain: pointerDomain,
      key: USERNAMES_POINTER_KEY,
      cid: manifestCid,
      mnemonic,
      dryRun,
      progress: (message) => console.log(message)
    })
  } finally {
    assetHub.destroy()
  }
  if (dryRun) console.log('\nDry run only, the record was not written.')
}

await main()
