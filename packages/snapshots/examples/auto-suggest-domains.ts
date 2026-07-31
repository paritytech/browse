/**
 * Suggest domains from a snapshot as a search box would.
 */

import { buildSnapshotBlocks } from '../src/blocks.js'
import { cidToBlake2b256DigestHex, shardKey } from '../src/format.js'
import { DomainSnapshotService } from '../src/service.js'

const NETWORK = '0xexample'

const labels = ['calculator', 'calendar', 'camera', 'canvas', 'stopwatch', 'timer'].sort()

const snapshot = buildSnapshotBlocks({
  version: 1,
  network: NETWORK,
  lines: labels,
  shardKeyOf: shardKey,
  generatedAt: Date.now()
})

// Stand in for the host preimage bridge, which serves a block by the digest its
// CID carries. Returning null for an unknown digest is what a real reader does
// when the host cannot produce the bytes.
const blocks = new Map(
  snapshot.blocks.map((block) => [cidToBlake2b256DigestHex(block.cid), block.data])
)
const readBlock = async (digest: `0x${string}`) => blocks.get(digest) ?? null

const domains = new DomainSnapshotService({
  readBlock,
  network: NETWORK,
  manifestCid: snapshot.manifestCid
})

console.log(`Published ${labels.length} labels in ${snapshot.shardCount} shard(s).`)

for (const prefix of ['ca', 'cal', 'st', 'zz']) {
  const suggestions = await domains.suggest(prefix)
  console.log(`  ${prefix.padEnd(4)} ${JSON.stringify(suggestions)}`)
}
