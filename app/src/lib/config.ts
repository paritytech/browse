import {
  isKnownGenesis,
  type NetworkGenesis,
  PASEO_ASSET_HUB_NEXT_V2_GENESIS,
  selectNetwork
} from '@parity/browse-sdk'

declare const process: { env?: Record<string, string | undefined> }

// The browser bundle reads import.meta.env. Playwright fixtures read process.env.
const NETWORK_GENESIS_HASH =
  import.meta.env?.NETWORK_GENESIS_HASH ??
  process.env?.NETWORK_GENESIS_HASH ??
  PASEO_ASSET_HUB_NEXT_V2_GENESIS

if (!isKnownGenesis(NETWORK_GENESIS_HASH)) {
  throw new Error(`Unknown NETWORK_GENESIS_HASH: ${NETWORK_GENESIS_HASH}`)
}

export const ASSET_HUB_PASEO_GENESIS: NetworkGenesis = NETWORK_GENESIS_HASH

export const NETWORK = selectNetwork(ASSET_HUB_PASEO_GENESIS)
export const SCHEMA_LIKE_ID = NETWORK.SCHEMA_ID

export const DRY_RUN_WEIGHT_LIMIT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n
}
export const DRY_RUN_STORAGE_LIMIT = 18_446_744_073_709_551_615n

export const DUMMY_ORIGIN = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
