import {
  activeAttestationResolver,
  activeSchemaId,
  isKnownGenesis,
  type NetworkGenesis,
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  selectNetwork
} from '@parity/browse-sdk'

declare const process: { env?: Record<string, string | undefined> }

// The browser bundle reads import.meta.env. Playwright fixtures read process.env.
const NETWORK_GENESIS_HASH =
  import.meta.env?.NETWORK_GENESIS_HASH ??
  process.env?.NETWORK_GENESIS_HASH ??
  PASEO_ASSETHUB_NEXT_V2_GENESIS

if (!isKnownGenesis(NETWORK_GENESIS_HASH)) {
  throw new Error(`Unknown NETWORK_GENESIS_HASH: ${NETWORK_GENESIS_HASH}`)
}

export const ASSETHUB_GENESIS: NetworkGenesis = NETWORK_GENESIS_HASH

export const NETWORK = selectNetwork(ASSETHUB_GENESIS)
export const ACTIVE_ATTESTATION_RESOLVER = activeAttestationResolver(NETWORK)
export const ACTIVE_SCHEMA_ID = activeSchemaId(NETWORK)

export const DRY_RUN_WEIGHT_LIMIT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n
}
export const DRY_RUN_STORAGE_LIMIT = 18_446_744_073_709_551_615n

export const DUMMY_ORIGIN = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1'

const APP_DOTNS_DOMAIN =
  import.meta.env?.APP_DOTNS_DOMAIN ?? process.env?.APP_DOTNS_DOMAIN ?? 'browse'

export const SELF_LABEL = APP_DOTNS_DOMAIN.toLowerCase().replace(/\.dot$/, '')

/**
 * Product identity presented on localhost, where the
 * real product account is not provisionable. The e2e host maps this same id to
 * a funded account, so keep the two in sync.
 */
export const LOCALHOST_SELF_DOTNS = `${SELF_LABEL}-beta00.dot`

/**
 * The identifier we present to the host when deriving the product account and
 * signing transactions.
 */
function resolveSelfDotns(): string {
  const fallback = `${SELF_LABEL}.dot`
  if (typeof window === 'undefined') return fallback
  const hostname = window.location.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1') {
    return LOCALHOST_SELF_DOTNS
  }
  return fallback
}

export const SELF_DOTNS = resolveSelfDotns()

/**
 * How long to wait for the host to fund the product account with PGAS after a
 * SmartContractAllowance grant before giving up.
 *
 * Overridable via `APP_PGAS_FUNDING_TIMEOUT`.
 *
 * The e2e suite sets it low so the unfundable path
 * fails fast instead of hanging on the full wait.
 */
export const PGAS_FUNDING_TIMEOUT = Number(
  import.meta.env?.APP_PGAS_FUNDING_TIMEOUT ?? process.env?.APP_PGAS_FUNDING_TIMEOUT ?? 30_000
)
