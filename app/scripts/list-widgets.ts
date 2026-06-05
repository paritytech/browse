/**
 * List every published app whose root manifest declares `kind: "widget"`.
 *
 *   cd app && bun scripts/list-widgets.ts             # paseo-next-v2 (default)
 *   cd app && bun scripts/list-widgets.ts previewnet  # previewnet
 *   cd app && MODALITY=app bun scripts/list-widgets.ts
 */

import {
  createBrowseSdk,
  MODALITIES,
  type Modality,
  PASEO_ASSET_HUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSET_HUB_GENESIS,
  selectNetwork
} from '@parity/browse-sdk'
import { getWsProvider } from '@polkadot-api/ws-provider'

const arg = (process.argv[2] ?? 'paseo').toLowerCase()
const genesis =
  arg === 'previewnet' ? PREVIEWNET_ASSET_HUB_GENESIS : PASEO_ASSET_HUB_NEXT_V2_GENESIS
const modality = (process.env.MODALITY ?? 'widget') as Modality
if (!(MODALITIES as readonly string[]).includes(modality)) {
  console.error(`MODALITY must be one of: ${MODALITIES.join(', ')}`)
  process.exit(1)
}

const network = selectNetwork(genesis)
console.log(`network:   ${arg === 'previewnet' ? 'previewnet' : 'paseo-next-v2'}`)
console.log(`rpc:       ${network.rpcs[0]}`)
console.log(
  `publisher: ${network.PUBLISHER.map((p) => `${p.version}@${p.address}`).join(', ') || '(none)'}`
)
console.log(`modality:  ${modality}\n`)

const sdk = createBrowseSdk(network, getWsProvider(network.rpcs[0]))

const t0 = performance.now()
const matches = await sdk.listAppsByModality(modality)
console.log(`Found ${matches.length} ${modality}(s) in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
for (const app of matches) {
  console.log(`  ${app.label}.dot  ${app.manifest.displayName}`)
  console.log(`    cid:  ${app.contentHash}`)
  console.log(`    desc: ${app.manifest.description}`)
}

sdk.destroy()
