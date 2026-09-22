import {
  isKnownGenesis,
  type NetworkGenesis,
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  publisherReadAddresses,
  selectNetwork
} from '@parity/browse-sdk'

declare const process: { env?: Record<string, string | undefined> }

// The browser bundle reads import.meta.env. Node (tests, scripts) reads process.env.
const NETWORK_GENESIS_HASH =
  import.meta.env?.NETWORK_GENESIS_HASH ??
  process.env?.NETWORK_GENESIS_HASH ??
  PASEO_ASSETHUB_NEXT_V2_GENESIS

if (!isKnownGenesis(NETWORK_GENESIS_HASH)) {
  throw new Error(`Unknown NETWORK_GENESIS_HASH: ${NETWORK_GENESIS_HASH}`)
}

export const ASSETHUB_GENESIS: NetworkGenesis = NETWORK_GENESIS_HASH

export const NETWORK = selectNetwork(ASSETHUB_GENESIS)

/** The current Publisher registry to write to (newest deployment, first in the list). */
export const ACTIVE_PUBLISHER = NETWORK.PUBLISHER[0]?.address
if (!ACTIVE_PUBLISHER) {
  throw new Error(`No Publisher registry configured for network ${ASSETHUB_GENESIS}`)
}

/** Every Publisher deployment, newest first. Reads union across all of them. */
export const PUBLISHER_READ_ADDRESSES = publisherReadAddresses(NETWORK)

/** The DotNS registrar, source of truth for `.dot` ownership. */
export const REGISTRAR = NETWORK.REGISTRAR

/**
 * Manifest CID of the daily verifiable `.dot` domain snapshot, used for publish
 * autocompletion. Unset disables suggestions. Set via `APP_DOMAINS_SNAPSHOT_CID`.
 */
export const DOMAINS_SNAPSHOT_CID =
  import.meta.env?.APP_DOMAINS_SNAPSHOT_CID ?? process.env?.APP_DOMAINS_SNAPSHOT_CID ?? undefined

// Gas and storage caps for the publish write. Publisher.publish is a small state
// write; the dry-run measures the real cost and this caps the submit. Matches the
// proven evm/scripts Revive.call limit.
export const CALL_WEIGHT = { ref_time: 10_000_000_000n, proof_size: 1_000_000n }
export const STORAGE_DEPOSIT_LIMIT = 1_000_000_000_000n

/**
 * How long to wait for the host to fund the signing account with PGAS after a
 * SmartContractAllowance grant before giving up. Overridable via
 * `APP_PGAS_FUNDING_TIMEOUT`.
 */
export const PGAS_FUNDING_TIMEOUT = Number(
  import.meta.env?.APP_PGAS_FUNDING_TIMEOUT ?? process.env?.APP_PGAS_FUNDING_TIMEOUT ?? 30_000
)
