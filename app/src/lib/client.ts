import { paseoHub } from '@polkadot-api/descriptors'
import type { SS58String } from 'polkadot-api'
import {
  Binary,
  createClient,
  FixedSizeBinary,
  type PolkadotClient,
  type TypedApi
} from 'polkadot-api'

import {
  ASSET_HUB_PASEO_GENESIS,
  DRY_RUN_STORAGE_LIMIT,
  DRY_RUN_WEIGHT_LIMIT,
  DUMMY_ORIGIN
} from './config'
import { dlog } from './debug'

export type PaseoHubApi = TypedApi<typeof paseoHub>

let clientInstance: PolkadotClient | null = null
let apiInstance: PaseoHubApi | null = null

let ensurePromise: Promise<PaseoHubApi> | null = null

export type ChainStatusCallback = (msg: string) => void
let onChainStatus: ChainStatusCallback | null = null

export function setChainStatusCallback(cb: ChainStatusCallback): void {
  onChainStatus = cb
}

async function doEnsureApi(): Promise<PaseoHubApi> {
  const t0 = performance.now()
  dlog('Importing product-sdk...')
  const sdk = await import('@novasamatech/product-sdk')
  dlog(`product-sdk loaded (${(performance.now() - t0).toFixed(0)}ms)`)

  dlog(`Creating papi provider for ${ASSET_HUB_PASEO_GENESIS.slice(0, 10)}...`)
  const provider = sdk.createPapiProvider(ASSET_HUB_PASEO_GENESIS)

  dlog('Creating polkadot-api client...')
  clientInstance = createClient(provider)

  dlog('Waiting for finalized block...')
  onChainStatus?.('Connecting to chain...')
  const block = await Promise.race([
    clientInstance.getFinalizedBlock(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Chain sync timed out after 120s')), 120_000)
    )
  ])
  dlog(`Connected to chain — block #${block.number} (${(performance.now() - t0).toFixed(0)}ms)`)

  apiInstance = clientInstance.getTypedApi(paseoHub)
  return apiInstance
}

export async function ensureApi(): Promise<PaseoHubApi> {
  if (apiInstance) return apiInstance
  if (!ensurePromise) {
    ensurePromise = doEnsureApi().catch((err) => {
      ensurePromise = null
      throw err
    })
  }
  return ensurePromise
}

export async function ensureClient(): Promise<PolkadotClient> {
  await ensureApi()
  return clientInstance!
}

export async function lookupOriginalAccount(h160: string): Promise<string | null> {
  const api = await ensureApi()
  try {
    const h160Hex = (h160.startsWith('0x') ? h160 : `0x${h160}`) as `0x${string}`
    const mapped = await api.query.Revive.OriginalAccount.getValue(FixedSizeBinary.fromHex(h160Hex))
    if (mapped) return mapped.toString?.() ?? null
    return null
  } catch {
    return null
  }
}

export async function reviveCall(
  contractAddress: string,
  encodedData: `0x${string}`,
  origin: string = DUMMY_ORIGIN,
  providedApi?: PaseoHubApi
): Promise<`0x${string}`> {
  const api = providedApi ?? (await ensureApi())

  const dryRun = await api.apis.ReviveApi.call(
    origin as SS58String,
    FixedSizeBinary.fromHex(contractAddress as `0x${string}`),
    0n,
    DRY_RUN_WEIGHT_LIMIT,
    DRY_RUN_STORAGE_LIMIT,
    Binary.fromHex(encodedData),
    { at: 'best' }
  )

  if (!dryRun.result.success) throw new Error('Revive call failed')
  const { flags, data } = dryRun.result.value
  if ((flags & 1) === 1) throw new Error('Contract execution reverted')
  return data.asHex() as `0x${string}`
}
