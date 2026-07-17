/**
 * Build and publish the daily username snapshot.
 *
 *   cd app && MNEMONIC="…" bun scripts/snapshot-usernames.ts [paseo|previewnet]
 *
 * Usernames live in the People chain DotNS `Resources.UsernameOwnerOf` map,
 * which maps username bytes to an owner SS58. This enumerates the whole map once
 * so the Following search bar can prefix-autocomplete from the snapshot with no
 * live chain read, exactly like the domains snapshot powers domain search. Each
 * shard line is `username\taccount`, so selecting a suggestion follows the owner
 * without another lookup.
 */

import { paseopeople, previewnetpeople } from '@polkadot-api/descriptors'
import {
  type NetworkGenesis,
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS,
  selectNetwork
} from '@parity/browse-sdk'
import { createClient, type TypedApi } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'

import { BULLETIN_RPC_BY_GENESIS, publishSnapshot, resolveGenesis, shardKey } from './lib/snapshot'

const SNAPSHOT_VERSION = 1

const PEOPLE_DESCRIPTOR_BY_GENESIS: Partial<
  Record<NetworkGenesis, typeof paseopeople | typeof previewnetpeople>
> = {
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: paseopeople,
  [PREVIEWNET_ASSETHUB_GENESIS]: previewnetpeople
}

type PeopleApi = TypedApi<typeof previewnetpeople>

/** Enumerate `Resources.UsernameOwnerOf` into sorted `username\taccount` lines. */
async function crawlUsernames(peopleApi: PeopleApi): Promise<string[]> {
  const entries = await peopleApi.query.Resources.UsernameOwnerOf.getEntries()
  const decoder = new TextDecoder()
  const lines: string[] = []
  for (const { keyArgs, value } of entries) {
    const username = decoder.decode(keyArgs[0]).toLowerCase()
    // Tabs/newlines would corrupt the `username\taccount` line framing.
    if (!username || username.includes('\t') || username.includes('\n')) continue
    lines.push(`${username}\t${value}`)
  }
  return lines
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
  const descriptor = PEOPLE_DESCRIPTOR_BY_GENESIS[genesis]
  const peopleRpc = network.PEOPLE_RPCS?.[0]
  if (!bulletinRpc) {
    console.error(`No Bulletin RPC configured for network ${genesis}`)
    process.exit(1)
  }
  if (!descriptor || !peopleRpc) {
    console.error(`No People chain configured for network ${genesis}`)
    process.exit(1)
  }

  console.log(`network:   ${genesis}`)
  console.log(`people:    ${peopleRpc}`)
  console.log(`bulletin:  ${bulletinRpc}\n`)

  const client = createClient(getWsProvider(peopleRpc))
  let lines: string[]
  try {
    lines = await crawlUsernames(client.getTypedApi(descriptor) as PeopleApi)
  } finally {
    client.destroy()
  }

  // Sort by line. Because `\t` is below every username character, this orders
  // entries by username, which the client prefix search relies on.
  lines = lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  console.log(`\nCollected ${lines.length} username(s)`)

  const { manifestCid, shardCount } = await publishSnapshot({
    version: SNAPSHOT_VERSION,
    genesis,
    bulletinRpc,
    mnemonic,
    lines,
    shardKeyOf: (line) => shardKey(line.slice(0, line.indexOf('\t')))
  })

  console.log(`\nPublished ${lines.length} usernames in ${shardCount} shards.`)
  console.log(`\nAPP_USERNAMES_SNAPSHOT_CID=${manifestCid}`)
}

await main()
