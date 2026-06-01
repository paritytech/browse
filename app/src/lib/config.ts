import {
  isKnownGenesis,
  type NetworkGenesis,
  PASEO_ASSET_HUB_NEXT_V2_GENESIS,
  selectNetwork
} from '@parity/browse-sdk'

declare const process: { env?: { VITE_ACTIVE_GENESIS?: string } } | undefined

const VITE_ACTIVE_GENESIS =
  (typeof import.meta !== 'undefined'
    ? (import.meta as { env?: { VITE_ACTIVE_GENESIS?: string } }).env?.VITE_ACTIVE_GENESIS
    : undefined) ??
  (typeof process !== 'undefined' ? process.env?.VITE_ACTIVE_GENESIS : undefined) ??
  PASEO_ASSET_HUB_NEXT_V2_GENESIS

if (!isKnownGenesis(VITE_ACTIVE_GENESIS)) {
  throw new Error(`Unknown VITE_ACTIVE_GENESIS: ${VITE_ACTIVE_GENESIS}`)
}

export const ASSET_HUB_PASEO_GENESIS: NetworkGenesis = VITE_ACTIVE_GENESIS

export const NETWORK = selectNetwork(ASSET_HUB_PASEO_GENESIS)
export const SCHEMA_LIKE_ID = NETWORK.SCHEMA_ID

export const DRY_RUN_WEIGHT_LIMIT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n
}
export const DRY_RUN_STORAGE_LIMIT = 18_446_744_073_709_551_615n

export const DUMMY_ORIGIN = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
