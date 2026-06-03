<div align="center">

# Home for privacy apps

<!-- markdownlint-disable-next-line MD013 -->
![CI](https://github.com/paritytech/browse/actions/workflows/build.yml/badge.svg)

<br>

> Find apps on privacy platforms. Save what you love. Recommend the best.

</div>

# @parity/browse-sdk

Client SDK for the [browse.dot](https://github.com/paritytech/browse) publishing registry. Walks the on-chain Publisher set, resolves labels via dotNS, and surfaces published apps, widgets, and workers over any papi-compatible `JsonRpcProvider`.

Part of the [browse](https://github.com/paritytech/browse) monorepo, published independently under Apache-2.0.

## Install

```sh
npm install @parity/browse-sdk
# peer-style helper for the example below
npm install @polkadot-api/ws-provider
```

## Usage

```ts
import {
  createBrowseSdk,
  PASEO_ASSET_HUB_NEXT_V2_GENESIS,
  selectNetwork
} from '@parity/browse-sdk'
import { getWsProvider } from '@polkadot-api/ws-provider'

const network = selectNetwork(PASEO_ASSET_HUB_NEXT_V2_GENESIS)
const sdk = createBrowseSdk(network, getWsProvider(network.rpcs[0]))

const widgets = await sdk.listAppsByModality('widget')

sdk.destroy()
```

Inside the browse app the provider comes from the host bridge:

```ts
import { createPapiProvider } from '@novasamatech/product-sdk'

const provider = createPapiProvider(PASEO_ASSET_HUB_NEXT_V2_GENESIS)
const sdk = createBrowseSdk(network, provider)
```

A runnable version of the snippet lives at [`examples/list-widgets.ts`](./examples/list-widgets.ts). Run it with `bun examples/list-widgets.ts` from this directory.

### Networks

Pass a custom `NetworkConfig` to `createBrowseSdk` to target any other deployment.

## License

Apache-2.0

## Happy browsing!