import { createPapiProvider, hostApi } from '@novasamatech/host-api-wrapper'
import {
  type BrowseSdk,
  createBrowseSdk,
  PASEO_ASSET_HUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSET_HUB_GENESIS,
  SUMMIT_ASSET_HUB_GENESIS
} from '@parity/browse-sdk'
import { paseohub, previewnethub, summithub } from '@polkadot-api/descriptors'
import type { PolkadotClient, TypedApi } from 'polkadot-api'

import { ASSET_HUB_GENESIS, DUMMY_ORIGIN, NETWORK } from './config'

const descriptor = ({
  [PASEO_ASSET_HUB_NEXT_V2_GENESIS]: paseohub,
  [PREVIEWNET_ASSET_HUB_GENESIS]: previewnethub,
  [SUMMIT_ASSET_HUB_GENESIS]: summithub
}[ASSET_HUB_GENESIS] ?? paseohub) as typeof paseohub

export type PaseoHubApi = TypedApi<typeof paseohub>

async function networkSupported(): Promise<boolean> {
  const payload = {
    tag: 'v1',
    value: { tag: 'Chain', value: ASSET_HUB_GENESIS }
  } as Parameters<typeof hostApi.featureSupported>[0]
  return hostApi.featureSupported(payload).match(
    (ok) => ok.value !== false,
    () => false
  )
}

// Async singleton
let sdkPromise: Promise<BrowseSdk> | null = null

export function ensureBrowseSdk(): Promise<BrowseSdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      if (!(await networkSupported())) {
        throw new Error(`Host does not support network ${ASSET_HUB_GENESIS}`)
      }
      return createBrowseSdk(NETWORK, createPapiProvider(ASSET_HUB_GENESIS))
    })().catch((err) => {
      sdkPromise = null
      throw err
    })
  }
  return sdkPromise
}

/**
 * Drop the cached SDK and destroy the old client. Destroying propagates the
 * disconnect through the host bridge so the host deletes its chain-connection
 * entry. Otherwise it reuses a stale, post-background/foreground connection
 * that never recovers.
 */
export function resetBrowseSdk(): void {
  const stale = sdkPromise
  sdkPromise = null
  void stale
    ?.then((sdk) => {
      try {
        sdk.destroy()
      } catch {
        // papi throws synchronously if a chainHead follow is still active
      }
    })
    .catch(() => {})
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`RPC timeout after ${ms}ms: ${label}`)), ms)
    promise.then(
      (value) => {
        clearTimeout(id)
        resolve(value)
      },
      (err) => {
        clearTimeout(id)
        reject(err)
      }
    )
  })
}

export const ensureClient = async (): Promise<PolkadotClient> =>
  (await ensureBrowseSdk()).getClient()

export const ensureApi = async (): Promise<PaseoHubApi> =>
  (await ensureBrowseSdk()).getClient().getTypedApi(descriptor)

// Host rate limiter is 20 req/s with a 100-slot queue; each ReviveApi.call
// fans out to ~3 papi ops (pin + call + unpin), and other host apps share the
// queue. Pace browse at ~2.5 aggregate3/s to leave a wide margin.
const MIN_RPC_INTERVAL_MS = 400
let lastRpcAt = 0
let rpcGateChain: Promise<void> = Promise.resolve()

function rpcGate(): Promise<void> {
  rpcGateChain = rpcGateChain.then(async () => {
    const wait = Math.max(0, lastRpcAt + MIN_RPC_INTERVAL_MS - performance.now())
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRpcAt = performance.now()
  })
  return rpcGateChain
}

export async function lookupOriginalAccount(h160: string): Promise<string | null> {
  const api = await ensureApi()
  await rpcGate()
  try {
    const h160Hex = (h160.startsWith('0x') ? h160 : `0x${h160}`) as `0x${string}`
    const mapped = await api.query.Revive.OriginalAccount.getValue(h160Hex)
    return mapped?.toString?.() ?? null
  } catch {
    return null
  }
}

export async function reviveCall(
  contractAddress: string,
  encodedData: `0x${string}`,
  origin: string = DUMMY_ORIGIN,
  _providedApi?: PaseoHubApi
): Promise<`0x${string}`> {
  void _providedApi
  // A dry-run contract read is sub-second when healthy. If it doesn't return in
  // RPC_TIMEOUT_MS the underlying request was almost certainly orphaned by a
  // socket swap.
  const RPC_TIMEOUT_MS = 8_000
  const attempt = async () => {
    const sdk = await ensureBrowseSdk()
    await rpcGate()
    return withTimeout(
      sdk.reviveCall(contractAddress as `0x${string}`, encodedData, origin),
      RPC_TIMEOUT_MS,
      contractAddress
    )
  }
  try {
    return await attempt()
  } catch {
    resetBrowseSdk()
    return attempt()
  }
}
