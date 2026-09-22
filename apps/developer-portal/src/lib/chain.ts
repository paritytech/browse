import { type BrowseSdk, createBrowseSdk } from '@parity/browse-sdk'
import { getHostProvider, isChainSupported } from '@parity/product-sdk/host'
import { AccountId, Binary, createClient, type PolkadotClient, type SS58String } from 'polkadot-api'

import { ASSETHUB_GENESIS, NETWORK } from './config'

/** Result of a dry-run contract call: the raw return data and whether it reverted. */
export type DryRunResult = { reverted: boolean; data: `0x${string}` }

// Minimal duck-typed shape of `client.getUnsafeApi().apis.ReviveApi`, resolved
// at runtime against network metadata so we ship no chain descriptors.
type ReviveRuntimeApi = {
  apis: {
    ReviveApi: {
      call: (
        origin: SS58String,
        target: `0x${string}`,
        value: bigint,
        gasLimit: { ref_time: bigint; proof_size: bigint },
        storageDepositLimit: bigint,
        data: ReturnType<typeof Binary.fromHex>,
        options?: { at?: string }
      ) => Promise<{
        result:
          | { success: true; value: { flags: number; data: ReturnType<typeof Binary.fromHex> } }
          | { success: false; value: unknown }
      }>
    }
  }
}

const DRY_RUN_GAS_LIMIT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n
}
const DRY_RUN_STORAGE_LIMIT = 18_446_744_073_709_551_615n

let sdkPromise: Promise<BrowseSdk> | null = null

async function ensureNetworkSupported(): Promise<void> {
  const result = await isChainSupported(ASSETHUB_GENESIS)
  const supported = result.ok ? result.value : false
  if (!supported) throw new Error(`Host does not support network ${ASSETHUB_GENESIS}`)
}

export function ensureBrowseSdk(): Promise<BrowseSdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      await ensureNetworkSupported()
      const provider = await getHostProvider(ASSETHUB_GENESIS)
      if (!provider) throw new Error(`Host provider unavailable for network ${ASSETHUB_GENESIS}`)
      return createBrowseSdk(NETWORK, provider)
    })().catch((err) => {
      sdkPromise = null
      throw err
    })
  }
  return sdkPromise
}

export async function ensureClient(): Promise<PolkadotClient> {
  return (await ensureBrowseSdk()).getClient()
}

/**
 * Dry-run a contract read and return its raw hex output.
 *
 * Throws when the call reverts. Use for view reads (`isPublished`, `ownerOf`)
 * where a revert is a genuine error, not an outcome to inspect.
 */
export async function reviveRead(
  target: `0x${string}`,
  data: `0x${string}`,
  origin?: SS58String
): Promise<`0x${string}`> {
  return (await ensureBrowseSdk()).reviveCall(target, data, origin)
}

/**
 * Dry-run a state-changing call and return its revert flag plus data, without
 * submitting. Lets the publish flow decode a contract revert (NotOwner,
 * NoPersonhood, RateLimitExceeded, EmptyLabel) into an actionable message
 * before the user signs.
 */
export async function dryRunCall(
  target: `0x${string}`,
  data: `0x${string}`,
  origin: SS58String
): Promise<DryRunResult> {
  const api = (await ensureClient()).getUnsafeApi() as unknown as ReviveRuntimeApi
  const res = await api.apis.ReviveApi.call(
    origin,
    target,
    0n,
    DRY_RUN_GAS_LIMIT,
    DRY_RUN_STORAGE_LIMIT,
    Binary.fromHex(data),
    { at: 'best' }
  )
  if (!res.result.success) throw new Error('Dry-run failed to execute')
  const { flags, data: ret } = res.result.value
  return { reverted: (flags & 1) === 1, data: Binary.toHex(ret) as `0x${string}` }
}

// The People chain client is created lazily and kept for username resolution.
let peoplePromise: Promise<PolkadotClient> | null = null

function ensurePeopleClient(): Promise<PolkadotClient> {
  if (!peoplePromise) {
    peoplePromise = (async () => {
      const genesis = NETWORK.PEOPLE_GENESIS
      if (!genesis) throw new Error(`No People chain configured for network ${ASSETHUB_GENESIS}`)
      const provider = await getHostProvider(genesis)
      if (!provider) throw new Error(`Host provider unavailable for People chain ${genesis}`)
      return createClient(provider)
    })().catch((err) => {
      peoplePromise = null
      throw err
    })
  }
  return peoplePromise
}

/**
 * Resolve a bare DotNS username to the 32-byte public key of its owning root
 * account, or `null` when the username owns no account.
 */
export async function resolveUsernameOwner(username: string): Promise<Uint8Array | null> {
  const client = await ensurePeopleClient()
  // Resolved at runtime against metadata, so no People descriptor is shipped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unsafeApi = client.getUnsafeApi() as any
  const owner = await unsafeApi.query.Resources.UsernameOwnerOf.getValue(
    new TextEncoder().encode(username)
  )
  if (!owner) return null
  return AccountId().enc(owner as SS58String)
}
