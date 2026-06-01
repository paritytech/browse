import { type BrowseSdk, createBrowseSdk } from '@parity/browse-sdk'
import { paseoHub } from '@polkadot-api/descriptors'
import type { PolkadotClient, TypedApi } from 'polkadot-api'

import { ASSET_HUB_PASEO_GENESIS, NETWORK } from './config'
import { hiddenLog } from './debug'

export type PaseoHubApi = TypedApi<typeof paseoHub>

let sdkInstance: BrowseSdk | null = null
let ensurePromise: Promise<BrowseSdk> | null = null

export type ChainStatusCallback = (msg: string) => void
let onChainStatus: ChainStatusCallback | null = null

export function setChainStatusCallback(cb: ChainStatusCallback): void {
  onChainStatus = cb
}

async function doEnsureSdk(): Promise<BrowseSdk> {
  const t0 = performance.now()
  const productSdk = await import('@novasamatech/product-sdk')
  const provider = productSdk.createPapiProvider(ASSET_HUB_PASEO_GENESIS)
  const sdk = createBrowseSdk(NETWORK, provider)

  onChainStatus?.('Connecting to chain...')
  const block = await Promise.race([
    sdk.getClient().getFinalizedBlock(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Chain sync timed out after 120s')), 120_000)
    )
  ])
  hiddenLog(
    `Connected to Dotns at block #${block.number} (${(performance.now() - t0).toFixed(0)}ms)`
  )

  sdkInstance = sdk
  return sdk
}

export async function ensureSdk(): Promise<BrowseSdk> {
  if (sdkInstance) return sdkInstance
  if (!ensurePromise) {
    ensurePromise = doEnsureSdk().catch((err) => {
      ensurePromise = null
      throw err
    })
  }
  return ensurePromise
}

export async function ensureClient(): Promise<PolkadotClient> {
  return (await ensureSdk()).getClient()
}

export async function ensureApi(): Promise<PaseoHubApi> {
  return (await ensureClient()).getTypedApi(paseoHub)
}

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
  const sdk = await ensureSdk()
  await rpcGate()
  return sdk.reviveCall(contractAddress as `0x${string}`, encodedData, origin)
}
