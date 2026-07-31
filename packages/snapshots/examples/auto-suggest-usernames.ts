/**
 * Suggest usernames from a snapshot.
 */

import { buildSnapshotBlocks } from '../src/blocks.js'
import { cidToBlake2b256DigestHex, shardKey } from '../src/format.js'
import { UsernameSnapshotService } from '../src/service.js'

const NETWORK = '0xexample'

const owners: Record<string, string> = {
  alice: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  alicia: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
  bob: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y'
}

// A tab sorts below every character a username can contain, so ordering the
// lines orders them by username, which the prefix search depends on.
const lines = Object.entries(owners)
  .map(([username, account]) => `${username}\t${account}`)
  .sort()

const snapshot = buildSnapshotBlocks({
  version: 1,
  network: NETWORK,
  lines,
  shardKeyOf: (line) => shardKey(line.slice(0, line.indexOf('\t'))),
  generatedAt: Date.now()
})

const blocks = new Map(
  snapshot.blocks.map((block) => [cidToBlake2b256DigestHex(block.cid), block.data])
)
const readBlock = async (digest: `0x${string}`) => blocks.get(digest) ?? null

const usernames = new UsernameSnapshotService({
  readBlock,
  network: NETWORK,
  manifestCid: snapshot.manifestCid
})

console.log(`Published ${lines.length} usernames in ${snapshot.shardCount} shard(s).`)

for (const prefix of ['al', 'ali', 'bo', 'zz']) {
  const suggestions = await usernames.suggest(prefix)
  console.log(
    `  ${prefix.padEnd(4)} ${suggestions.map((entry) => entry.username).join(', ') || '(none)'}`
  )
  for (const entry of suggestions) {
    console.log(`         ${entry.username} -> ${entry.account}`)
  }
}
