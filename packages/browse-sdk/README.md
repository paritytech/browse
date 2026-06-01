# @parity/browse-sdk

Client SDK for the [browse.dot](https://browse.dot) publishing registry. Walks the on-chain Publisher set, resolves labels via dotNS, and surfaces published apps, widgets, and workers over any papi-compatible `JsonRpcProvider`.

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
// Each entry's `contentHash` is the CID at `widget.<label>.dot`.

sdk.destroy()
```

Inside the browse app the provider comes from the host bridge:

```ts
import { createPapiProvider } from '@novasamatech/product-sdk'

const provider = createPapiProvider(PASEO_ASSET_HUB_NEXT_V2_GENESIS)
const sdk = createBrowseSdk(network, provider)
```

A runnable version of the snippet lives at [`examples/list-widgets.ts`](./examples/list-widgets.ts). Run it with `bun examples/list-widgets.ts` from this directory.

## API

### `BrowseSdk`

| Method | Returns |
|---|---|
| `listAppsByModality(modality)` | `AppListing[]` for every published label that has content bound to its `<modality>.<label>.dot` subname. |
| `listPublishedLabelhashes()` | All labelhashes from `Publisher.getPublished`, paginated. Returns `[]` when no Publisher is configured. |
| `resolveLabels(labelhashes)` | String labels via batched `Registrar.labelOf`. |
| `hydrateApps(labels)` | Two-pass multicall (`contenthash` then manifest text record) into `AppListing[]`. |
| `multicall(calls)` | Generic batched `Multicall3.aggregate3` read; auto-chunked. |
| `reviveCall(target, data, origin?)` | Single contract dry-run via `ReviveApi.call`; the primitive everything else builds on. |
| `getClient()` / `destroy()` | Share or tear down the underlying polkadot-api client. |

### `Modality`

```ts
type Modality = 'app' | 'widget' | 'worker'
```

A label binds a modality by minting `<modality>.<label>.dot` and setting its `contenthash`. A single label can ship any subset. `widget.browse.dot` carries the embeddable widget bundle. `worker.<label>.dot` carries the worker.

### Networks

`selectNetwork(genesis)` returns a `NetworkConfig` (addresses and RPC URLs) for one of the preconfigured chains:

- `PASEO_ASSET_HUB_V1_GENESIS`
- `PASEO_ASSET_HUB_NEXT_V2_GENESIS`
- `PREVIEWNET_ASSET_HUB_GENESIS`

Pass a custom `NetworkConfig` to `createBrowseSdk` to target any other deployment.

## License

Apache-2.0
