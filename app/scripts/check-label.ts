/**
 * One-off: ask the configured network whether `<label>.dot` exists and what
 * content/manifest is bound to it. Goes through @parity/browse-sdk's
 * `BrowseSdk` over a `getWsProvider` papi provider.
 *
 *   cd app && bun scripts/check-label.ts host-playground33
 *   cd app && WS_URL=wss://… bun scripts/check-label.ts foo
 *   cd app && GENESIS=paseo bun scripts/check-label.ts foo
 */

import {
  createBrowseSdk,
  decodeAddress,
  decodeBytes,
  decodeIpfsContenthash,
  decodeString,
  encodeContenthash,
  encodeLabelOf,
  encodeNodeOwner,
  encodePublishedCount,
  encodeText,
  labelhashToTokenId,
  namehash,
  PASEO_ASSET_HUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSET_HUB_GENESIS,
  selectNetwork
} from '@parity/browse-sdk'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { getWsProvider } from '@polkadot-api/ws-provider'

const label = process.argv[2] ?? 'host-playground33'
const genesis =
  process.env.GENESIS === 'paseo'
    ? PASEO_ASSET_HUB_NEXT_V2_GENESIS
    : PREVIEWNET_ASSET_HUB_GENESIS
const network = selectNetwork(genesis)
const WS_URL = process.env.WS_URL ?? network.rpcs[0]

console.log(`Connecting to ${WS_URL}`)
const provider = getWsProvider(WS_URL)
const sdk = createBrowseSdk(network, provider)
const client = sdk.getClient()

const finalized = await client.getFinalizedBlock()
console.log(`Connected; finalized block #${finalized.number} hash ${finalized.hash}`)

const chainSpec = await client.getChainSpecData()
console.log(`Chain genesis: ${chainSpec.genesisHash}`)
console.log(`SDK expected:  ${genesis}`)
console.log(chainSpec.genesisHash === genesis ? '✓ match' : '✗ MISMATCH')

function labelhashOf(s: string): `0x${string}` {
  const bytes = new TextEncoder().encode(s)
  const hash = keccak_256(bytes)
  let out = '0x'
  for (const b of hash) out += b.toString(16).padStart(2, '0')
  return out as `0x${string}`
}

const node = namehash(`${label}.dot`)
const lh = labelhashOf(label)
const tokenId = labelhashToTokenId(lh)

console.log(`\nLabel:     ${label}.dot`)
console.log(`namehash:  ${node}`)
console.log(`labelhash: ${lh}`)
console.log(`tokenId:   ${tokenId}`)

console.log(`\nRegistry.owner:`)
try {
  const ownerHex = await sdk.reviveCall(network.REGISTRY, encodeNodeOwner(node))
  const owner = decodeAddress(ownerHex)
  console.log(
    `  decoded: ${owner}${owner === '0x0000000000000000000000000000000000000000' ? ' (unowned)' : ''}`
  )
} catch (err) {
  console.log(`  reverted (node not registered): ${(err as Error).message}`)
}

console.log(`\nMulticall3 sanity (batched contenthash):`)
try {
  const batched = await sdk.multicall([
    { target: network.CONTENT_RESOLVER, callData: encodeContenthash(node) }
  ])
  console.log(`  multicall returned ${batched.length} result(s)`)
  console.log(`  sub-call success: ${batched[0]?.success}`)
  console.log(`  sub-call returnData: ${batched[0]?.returnData?.slice(0, 80)}…`)
} catch (err) {
  console.log(`  multicall failed: ${(err as Error).message}`)
}

console.log(`\nContentResolver.contenthash:`)
try {
  const contentHex = await sdk.reviveCall(network.CONTENT_RESOLVER, encodeContenthash(node))
  const contentBytes = decodeBytes(contentHex)
  console.log(`  bytes:   ${contentBytes}`)
  console.log(`  ipfs:    ${decodeIpfsContenthash(contentBytes) ?? '(none)'}`)
} catch (err) {
  console.log(`  reverted: ${(err as Error).message}`)
}

console.log(`\nContentResolver.text(node, 'manifest'):`)
try {
  const manifestHex = await sdk.reviveCall(network.CONTENT_RESOLVER, encodeText(node, 'manifest'))
  const manifestStr = decodeString(manifestHex)
  console.log(`  ${manifestStr.length > 0 ? manifestStr : '(empty)'}`)
} catch (err) {
  console.log(`  reverted: ${(err as Error).message}`)
}

console.log(`\nRegistrar.labelOf(tokenId):`)
try {
  const labelOfHex = await sdk.reviveCall(network.REGISTRAR, encodeLabelOf(tokenId))
  console.log(`  decoded: "${decodeString(labelOfHex)}"`)
} catch (err) {
  console.log(`  reverted: ${(err as Error).message}`)
}

console.log(`\nPublisher.publishedCount:`)
if (network.PUBLISHER.length === 0) {
  console.log(`  (PUBLISHER not configured for this network)`)
} else {
  for (const { version, address } of network.PUBLISHER) {
    try {
      const countHex = await sdk.reviveCall(address, encodePublishedCount())
      console.log(`  ${version} (${address}): ${BigInt(countHex)}`)
    } catch (err) {
      console.log(`  ${version} (${address}): reverted (${(err as Error).message})`)
    }
  }
}

sdk.destroy()
