/**
 * List every published product that ships a widget modality.
 */

import { getWsProvider } from "@polkadot-api/ws-provider";

import {
  createBrowseSdk,
  PASEO_ASSET_HUB_NEXT_V2_GENESIS,
  selectNetwork,
} from "../src/index";

const network = selectNetwork(PASEO_ASSET_HUB_NEXT_V2_GENESIS);
const browseSdk = createBrowseSdk(network, getWsProvider(network.rpcs[0]));

const widgets = await browseSdk.listAppsByModality("widget");

console.log(`Found ${widgets.length} widget(s):`);
for (const widget of widgets) {
  console.log(`  ${widget.label}.dot  ${widget.manifest.displayName}`);
  console.log(`    cid:  ${widget.contentHash}`);
  console.log(`    desc: ${widget.manifest.description}`);
}

browseSdk.destroy();
