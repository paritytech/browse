import { createPapiProvider, hostApi } from '@novasamatech/host-api-wrapper'
import {
  type BrowseSdk,
  createBrowseSdk,
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS,
  SUMMIT_ASSETHUB_GENESIS
} from '@parity/browse-sdk'
import {
  paseohub,
  paseopeople,
  previewnethub,
  previewnetpeople,
  summithub
} from '@polkadot-api/descriptors'
import {
  AccountId,
  createClient,
  type PolkadotClient,
  type SS58String,
  type TypedApi
} from 'polkadot-api'

import { ASSETHUB_GENESIS, DUMMY_ORIGIN, NETWORK } from './config'

const descriptor = ({
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: paseohub,
  [PREVIEWNET_ASSETHUB_GENESIS]: previewnethub,
  [SUMMIT_ASSETHUB_GENESIS]: summithub
}[ASSETHUB_GENESIS] ?? paseohub) as typeof paseohub

export type PaseoHubApi = TypedApi<typeof paseohub>

async function networkSupported(): Promise<boolean> {
  const payload = {
    tag: 'v1',
    value: { tag: 'Chain', value: ASSETHUB_GENESIS }
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
    console.warn(
      'debug network connection',
      JSON.stringify({ event: 'ensureBrowseSdk:creating', genesis: ASSETHUB_GENESIS })
    )
    sdkPromise = (async () => {
      const supported = await networkSupported()
      console.warn(
        'debug network connection',
        JSON.stringify({ event: 'ensureBrowseSdk:networkSupported', supported })
      )
      if (!supported) {
        throw new Error(`Host does not support network ${ASSETHUB_GENESIS}`)
      }
      const sdk = createBrowseSdk(NETWORK, createPapiProvider(ASSETHUB_GENESIS))
      console.warn('debug network connection', JSON.stringify({ event: 'ensureBrowseSdk:created' }))
      return sdk
    })().catch((err) => {
      console.warn(
        'debug network connection',
        JSON.stringify({ event: 'ensureBrowseSdk:failed', err: String(err) })
      )
      sdkPromise = null
      throw err
    })
  } else {
    console.warn('debug network connection', JSON.stringify({ event: 'ensureBrowseSdk:reuse' }))
  }
  return sdkPromise
}

// A reset destroys the shared client, which disjoints every in-flight operation
// on it.
let pendingWrites = 0
let resetRequested = false

/** Bracket a network request so a concurrent reset is deferred, not applied under it. */
export function startTransaction(): void {
  pendingWrites += 1
  console.warn(
    'debug network connection',
    JSON.stringify({ event: 'startTransaction', pendingWrites })
  )
}

export function endTransaction(): void {
  pendingWrites = Math.max(0, pendingWrites - 1)
  console.warn(
    'debug network connection',
    JSON.stringify({ event: 'endTransaction', pendingWrites, resetRequested })
  )
  if (pendingWrites === 0 && resetRequested) {
    resetRequested = false
    resetBrowseSdk()
  }
}

/**
 * Drop the cached SDK and destroy the old client. Destroying propagates the
 * disconnect through the host bridge so the host deletes its chain-connection
 * entry. Otherwise it reuses a stale, post-background/foreground connection
 * that never recovers. Deferred while a chain write is in flight.
 */
export function resetBrowseSdk(): void {
  console.warn(
    'debug network connection',
    JSON.stringify({
      event: 'resetBrowseSdk:called',
      pendingWrites,
      hasSdk: !!sdkPromise,
      resetRequested
    })
  )
  if (pendingWrites > 0) {
    resetRequested = true
    console.warn('debug network connection', JSON.stringify({ event: 'resetBrowseSdk:deferred' }))
    return
  }
  const stale = sdkPromise
  sdkPromise = null
  if (!stale) {
    console.warn(
      'debug network connection',
      JSON.stringify({ event: 'resetBrowseSdk:nothingToDestroy' })
    )
    return
  }
  console.warn('debug network connection', JSON.stringify({ event: 'resetBrowseSdk:destroying' }))
  void stale
    ?.then((sdk) => {
      try {
        sdk.destroy()
        console.warn(
          'debug network connection',
          JSON.stringify({ event: 'resetBrowseSdk:destroyed' })
        )
      } catch (err) {
        // papi throws synchronously if a chainHead follow is still active
        console.warn(
          'debug network connection',
          JSON.stringify({ event: 'resetBrowseSdk:destroyThrew', err: String(err) })
        )
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
    console.warn(
      'debug network connection',
      JSON.stringify({ event: 'reviveCall:attempt', contractAddress })
    )
    return withTimeout(
      sdk.reviveCall(contractAddress as `0x${string}`, encodedData, origin),
      RPC_TIMEOUT_MS,
      contractAddress
    )
  }
  try {
    return await attempt()
  } catch (err) {
    console.warn(
      'debug network connection',
      JSON.stringify({ event: 'reviveCall:failed', contractAddress, err: String(err) })
    )
    resetBrowseSdk()
    return attempt()
  }
}

const PEOPLE_DESCRIPTOR_BY_ASSETHUB = {
  [PREVIEWNET_ASSETHUB_GENESIS]: previewnetpeople,
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: paseopeople
} as const

type PeopleApi = TypedApi<typeof previewnetpeople>

let peoplePromise: Promise<PeopleApi> | null = null

export function ensurePeopleApi(): Promise<PeopleApi> {
  if (!peoplePromise) {
    console.warn('debug network connection', JSON.stringify({ event: 'ensurePeopleApi:creating' }))
    peoplePromise = (async () => {
      const genesis = NETWORK.PEOPLE_GENESIS
      const descriptor =
        PEOPLE_DESCRIPTOR_BY_ASSETHUB[
          ASSETHUB_GENESIS as keyof typeof PEOPLE_DESCRIPTOR_BY_ASSETHUB
        ]
      console.warn(
        'debug network connection',
        JSON.stringify({
          event: 'ensurePeopleApi:config',
          genesis,
          hasDescriptor: !!descriptor,
          assethub: ASSETHUB_GENESIS
        })
      )
      if (!genesis || !descriptor) {
        throw new Error(`No People chain configured for network ${ASSETHUB_GENESIS}`)
      }
      const client = createClient(createPapiProvider(genesis))
      console.warn('debug network connection', JSON.stringify({ event: 'ensurePeopleApi:created' }))
      return client.getTypedApi(descriptor) as PeopleApi
    })().catch((err) => {
      console.warn(
        'debug network connection',
        JSON.stringify({ event: 'ensurePeopleApi:failed', err: String(err) })
      )
      peoplePromise = null
      throw err
    })
  } else {
    console.warn('debug network connection', JSON.stringify({ event: 'ensurePeopleApi:reuse' }))
  }
  return peoplePromise
}

/**
 * Resolve a bare DotNS username to the 32-byte
 * public key of its owning root account, or `null` when the username owns no
 * account.
 */
export async function resolveUsernameOwner(username: string): Promise<Uint8Array | null> {
  console.warn(
    'debug network connection',
    JSON.stringify({ event: 'resolveUsernameOwner:start', username })
  )
  const api = await ensurePeopleApi()
  console.warn(
    'debug network connection',
    JSON.stringify({ event: 'resolveUsernameOwner:querying' })
  )
  const owner = await api.query.Resources.UsernameOwnerOf.getValue(
    new TextEncoder().encode(username)
  )
  console.warn(
    'debug network connection',
    JSON.stringify({ event: 'resolveUsernameOwner:returned', owner: owner ?? null })
  )
  if (!owner) return null
  return AccountId().enc(owner as SS58String)
}
