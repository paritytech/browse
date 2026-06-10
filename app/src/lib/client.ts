import { createPapiProvider, hostApi } from '@novasamatech/host-api-wrapper'
import { type BrowseSdk, createBrowseSdk } from '@parity/browse-sdk'
import { paseoHub } from '@polkadot-api/descriptors'
import type { PolkadotClient, TypedApi } from 'polkadot-api'

import { ASSET_HUB_PASEO_GENESIS, NETWORK } from './config'

export type PaseoHubApi = TypedApi<typeof paseoHub>

async function networkSupported(): Promise<boolean> {
  const payload = {
    tag: 'v1',
    value: { tag: 'Chain', value: ASSET_HUB_PASEO_GENESIS }
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
        throw new Error(`Host does not support network ${ASSET_HUB_PASEO_GENESIS}`)
      }
      return createBrowseSdk(NETWORK, createPapiProvider(ASSET_HUB_PASEO_GENESIS))
    })().catch((err) => {
      sdkPromise = null
      throw err
    })
  }
  return sdkPromise
}

/**
 * Drop the cached SDK so the next {@link ensureBrowseSdk} rebuilds a fresh papi
 * provider with a new `chainHead_follow`. Needed after a silent socket swap.
 */
export function resetBrowseSdk(): void {
  sdkPromise = null
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
  (await ensureBrowseSdk()).getClient().getTypedApi(paseoHub)

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

const DUMMY_ORIGIN_DEFAULT = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

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
  origin: string = DUMMY_ORIGIN_DEFAULT,
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
