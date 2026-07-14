import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { createClient, type PolkadotClient, type SS58String } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { bytesToHex, hexToBytes } from 'viem'

import { claimPgas } from './claim-pgas'
import { AttestationService } from '../../src/lib/attestation-service'
import { ACTIVE_ATTESTATION_RESOLVER, NETWORK } from '../../src/lib/config'
import { DEV_PHRASE as IDENTITY_PHRASE, identityPath } from '../utils'

// Keep the funder above this PGAS balance. One claim mints far more, so a single
// successful claim covers many tests. Claim across daily slots to top up.
const FUNDER_PGAS_FLOOR = 20_000_000_000n
const MAX_CLAIM_SLOTS = 20

const RPC_ENDPOINTS = [...NETWORK.ASSETHUB_RPCS]

// Amounts transferred on a top-up (the `amount` passed to the fund helpers).
export const DEFAULT_PGAS_AMOUNT = 5_000_000_000n
// The unbound product account pays its whole first-recommend batch in PGAS via
// the AsPgas route, since a non-zero balance makes the app skip the allowance
// grant. Seed enough to cover the two-call batch of `bindIdentity` and
// `attest`, which a token seed does not. Reclaimed to the master after the run.
export const PGAS_SEED_AMOUNT = 10_000_000_000n
// Native only pays tx fees, so a small grant is plenty. Kept well under the
// funder balance so it can seed several sub-accounts without a native top-up.
const DEFAULT_NATIVE_AMOUNT = 100_000_000_000n

// A top-up is skipped when the recipient already holds at least this much.
const PGAS_TOPUP_THRESHOLD = 1_000_000_000n
const NATIVE_TOPUP_THRESHOLD = 50_000_000_000n

function signerFor(miniSecret: Uint8Array, path: string) {
  const wallet = sr25519CreateDerive(miniSecret)(path)
  return {
    signer: getPolkadotSigner(wallet.publicKey, 'Sr25519', async (input: Uint8Array) =>
      wallet.sign(input)
    ),
    address: ss58Encode(wallet.publicKey, 42),
    publicKey: wallet.publicKey
  }
}

type Credentials = ReturnType<typeof signerFor>
type UnsafeApi = ReturnType<PolkadotClient['getUnsafeApi']>

/**
 * Submit a tx and resolve on inclusion, retrying on a stale nonce. The shared
 * funder is signed from concurrently (parallel workers, overlapping CI runs,
 * manual use), so its nonce can be taken between read and submit; resubmitting
 * reads the advanced nonce.
 */
async function watchTxWithRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeTx: () => { signSubmitAndWatch: (signer: any) => { subscribe: (o: any) => void } },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: any,
  label: string
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        makeTx()
          .signSubmitAndWatch(signer)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .subscribe({
            next: (event: any) => {
              if (
                !((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized')
              )
                return
              if (event.ok === false) {
                reject(new Error(`${label} failed: ${JSON.stringify(event.dispatchError)}`))
              } else {
                resolve()
              }
            },
            error: reject
          })
      })
      return
    } catch (e) {
      if (attempt < 3 && /stale/i.test(String(e))) {
        await new Promise((r) => setTimeout(r, 400))
        continue
      }
      throw e
    }
  }
}

export function createDevSigner(name: string) {
  return signerFor(mnemonicToMiniSecret(DEV_PHRASE, ''), `//${name}`)
}

/**
 * The per-run identity the app attests with and that tests follow. Derived off
 * `smalltava.05` at a run-unique path so a stuck one-per-identity lock left by a
 * dead account on one run never blocks another, and concurrent runs never
 * contend on the same identity. Funded and self-bound by {@link fundIdentity}.
 */
export function createProductSigner() {
  return signerFor(mnemonicToMiniSecret(IDENTITY_PHRASE, ''), identityPath())
}

/**
 * The shared master: `smalltava.05` `//wallet`, the ring member that can claim
 * PGAS from the personhood faucet. It funds every per-run identity and dev
 * account and is the sink reclaims recycle to. It only ever moves funds, never
 * attests, so concurrent runs sharing it hit only nonce contention, which the
 * stale-nonce retry absorbs.
 */
export function createMasterSigner() {
  return signerFor(mnemonicToMiniSecret(IDENTITY_PHRASE, ''), '//wallet')
}

/** Run `fn` with a throwaway Asset Hub client, destroying it afterward. */
async function withAssetHubApi<T>(fn: (api: UnsafeApi) => Promise<T>): Promise<T> {
  const client = createClient(
    getWsProvider(RPC_ENDPOINTS, {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )
  try {
    return await fn(client.getUnsafeApi())
  } finally {
    try {
      client.destroy()
    } catch {
      // ignore teardown errors
    }
  }
}

async function pgasBalanceOf(api: UnsafeApi, assetId: number, addr: string): Promise<bigint> {
  const acct = (await api.query.Assets.Account.getValue(assetId, addr as SS58String)) as
    | { balance?: bigint }
    | undefined
  return acct?.balance ?? 0n
}

async function transferPgas(
  api: UnsafeApi,
  assetId: number,
  from: Credentials,
  to: string,
  amount: bigint
): Promise<void> {
  // Fail with a clear top-up message when the funder is short, rather than the
  // opaque `Assets.NoAccount`/`BalanceLow` the transfer would otherwise throw.
  const funderBalance = await pgasBalanceOf(api, assetId, from.address)
  if (funderBalance < amount) {
    throw new Error(
      `PGAS funder ${from.address} holds ${funderBalance}, below the ${amount} needed to fund the test account. ` +
        `Top up its PGAS (asset ${assetId}) on the active network.`
    )
  }
  await watchTxWithRetry(
    () =>
      api.tx.Assets.transfer({
        id: assetId,
        target: { type: 'Id', value: to as SS58String },
        amount
      }),
    from.signer,
    'PGAS transfer'
  )
}

export interface FundResult {
  topUp: boolean
  toAddress: string
  pgasBalance: bigint
}

/**
 * Ensure dev account `toAccount` holds enough PGAS to pay for contract calls.
 * Idempotent: skips the transfer when already above `PGAS_TOPUP_THRESHOLD`. `from`
 * defaults to the identity account ({@link createProductSigner}), the single
 * funder that holds both PGAS and native on the dev networks.
 */
/**
 * Ensure the funder holds PGAS, self-claiming from the personhood faucet when it
 * has run dry. The funder is also the product account that signs attestations,
 * so it must stay funded for both transfers and its own contract calls.
 */
export async function ensureFunderPgas(from: Credentials = createMasterSigner()): Promise<void> {
  await withAssetHubApi(async (api) => {
    const assetId = (await api.constants.Pgas.PgasAssetId()) as number
    let balance = await pgasBalanceOf(api, assetId, from.address)
    for (let slot = 0; slot < MAX_CLAIM_SLOTS && balance < FUNDER_PGAS_FLOOR; slot++) {
      try {
        const { claimed } = await claimPgas(from.address, slot)
        if (!claimed) break
      } catch {
        // Slot already claimed today or a transient failure, so try the next slot.
        continue
      }
      balance = await pgasBalanceOf(api, assetId, from.address)
    }
  })
}

export async function fundWithPgas(
  toAccount = 'Charlie',
  amount: bigint = DEFAULT_PGAS_AMOUNT,
  from: Credentials = createMasterSigner()
): Promise<FundResult> {
  return fundAddressWithPgas(createDevSigner(toAccount).address, amount, from)
}

/** Top up any address with PGAS from `from`, skipping when already funded. */
export async function fundAddressWithPgas(
  toAddress: string,
  amount: bigint = DEFAULT_PGAS_AMOUNT,
  from: Credentials = createMasterSigner()
): Promise<FundResult> {
  await ensureFunderPgas(from)
  return withAssetHubApi(async (api) => {
    const assetId = (await api.constants.Pgas.PgasAssetId()) as number
    const balance = await pgasBalanceOf(api, assetId, toAddress)
    if (balance >= PGAS_TOPUP_THRESHOLD) {
      return { topUp: false, toAddress, pgasBalance: balance }
    }
    await transferPgas(api, assetId, from, toAddress, amount)
    return {
      topUp: true,
      toAddress,
      pgasBalance: await pgasBalanceOf(api, assetId, toAddress)
    }
  })
}

/**
 * Map the `tag` account in pallet-revive, only if not already mapped, so its
 * contract `msg.sender` is the standard `keccak(pubkey)[12:]` H160 the app binds
 * against. A mapped account has a `Revive.OriginalAccount` entry under that H160.
 */
export async function mapAccount(tag: string): Promise<void> {
  const acct = createDevSigner(tag)
  const h160 = (ss58ToEthereum(acct.address as SS58String) as `0x${string}`).toLowerCase()
  await withAssetHubApi(async (api) => {
    if (await api.query.Revive.OriginalAccount.getValue(h160)) return
    await new Promise<void>((resolve, reject) => {
      api.tx.Revive.map_account()
        .signSubmitAndWatch(acct.signer)
        .subscribe({
          next: (event) => {
            if (
              !((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized')
            )
              return
            if (event.ok === false) {
              reject(new Error(`map_account failed: ${JSON.stringify(event.dispatchError)}`))
            } else {
              resolve()
            }
          },
          error: reject
        })
    })
  })
}

/**
 * Send the entire PGAS balance of `fromTag` to `to` so the pool recycles.
 * Defaults to the identity account.
 */
export async function transferAllWithPgas(
  fromTag: string,
  to: string = createMasterSigner().address
): Promise<void> {
  const from = createDevSigner(fromTag)
  try {
    await withAssetHubApi(async (api) => {
      const assetId = (await api.constants.Pgas.PgasAssetId()) as number
      const balance = await pgasBalanceOf(api, assetId, from.address)
      if (balance === 0n) return
      await new Promise<void>((resolve, reject) => {
        api.tx.Assets.transfer({
          id: assetId,
          target: { type: 'Id', value: to as SS58String },
          amount: balance
        })
          .signSubmitAndWatch(from.signer)
          .subscribe({
            next: (event) => {
              if (
                !((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized')
              )
                return
              if (event.ok === false) {
                reject(
                  new Error(`PGAS transfer_all failed: ${JSON.stringify(event.dispatchError)}`)
                )
              } else {
                resolve()
              }
            },
            error: reject
          })
      })
    })
  } catch (e) {
    // A failed reclaim strands this account's PGAS permanently (the tag is
    // random per run), so surface it loudly instead of leaking silently.
    console.error(
      `transferAllWithPgas from ${fromTag} (${from.address}) to ${to} failed; PGAS is now stranded:`,
      e
    )
    throw e
  }
}

/**
 * Send the entire native balance of `fromTag` to `to` and reap the account, so a
 * throwaway account does not permanently drain the funder. Defaults to the
 * identity funder. Call after every other tx the account signs, since it leaves
 * nothing for fees.
 */
export async function transferAllWithNative(
  fromTag: string,
  to: string = createMasterSigner().address
): Promise<void> {
  const from = createDevSigner(fromTag)
  await withAssetHubApi(async (api) => {
    await new Promise<void>((resolve, reject) => {
      api.tx.Balances.transfer_all({
        dest: { type: 'Id', value: to as SS58String },
        keep_alive: false
      })
        .signSubmitAndWatch(from.signer)
        .subscribe({
          next: (event) => {
            if (
              !((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized')
            )
              return
            if (event.ok === false) {
              reject(
                new Error(`native transfer_all failed: ${JSON.stringify(event.dispatchError)}`)
              )
            } else {
              resolve()
            }
          },
          error: reject
        })
    })
  })
}

/**
 * Ensure `toAddress` holds enough native token to pay tx fees. The identity
 * account signs fixture txs with a plain signer that pays fees in native, but it
 * only holds PGAS, so it needs a native top-up. Idempotent: skips when already
 * above `NATIVE_TOPUP_THRESHOLD`.
 */
export async function fundWithNative(
  toAddress: string,
  amount: bigint = DEFAULT_NATIVE_AMOUNT
): Promise<void> {
  const funder = createMasterSigner()
  // The funder is the native source, so it cannot top up itself.
  if (toAddress === funder.address) return
  await withAssetHubApi(async (api) => {
    const current = (await api.query.System.Account.getValue(toAddress as SS58String)) as {
      data?: { free?: bigint }
    }
    if ((current?.data?.free ?? 0n) >= NATIVE_TOPUP_THRESHOLD) return

    await watchTxWithRetry(
      () =>
        api.tx.Balances.transfer_keep_alive({
          dest: { type: 'Id', value: toAddress as SS58String },
          value: amount
        }),
      funder.signer,
      'native transfer'
    )
  })
}

// The per-run identity signs many attests across a suite, and browser recommends
// consume its PGAS without a refill, so seed it generously in one shot.
const IDENTITY_PGAS_AMOUNT = 30_000_000_000n

/**
 * Prepare the per-run identity so it can bind and attest: fund native + PGAS
 * from the master and self-bind it on the active resolver. Runs once per run via
 * globalSetup. Idempotent, and a no-op locally where the identity is the master.
 */
export async function fundIdentity(): Promise<void> {
  const master = createMasterSigner()
  const identity = createProductSigner()
  await ensureFunderPgas(master)
  if (identity.address === master.address) return
  await fundWithNative(identity.address)
  await fundAddressWithPgas(identity.address, IDENTITY_PGAS_AMOUNT, master)
  await ensureIdentityBound(identity)
}

const BINDING_MESSAGE_PREFIX = 'attestation v1\n'

/**
 * Self-bind the identity on the active resolver so it can attest. The gated
 * resolver only admits a bound attester, and a fresh per-run identity starts
 * unbound. The identity signs the binding message over its own address and
 * submits `bindIdentity`, mirroring the app on a first recommendation.
 */
async function ensureIdentityBound(identity: Credentials): Promise<void> {
  const h160 = ss58ToEthereum(identity.address as SS58String).toLowerCase() as `0x${string}`
  const client = createClient(
    getWsProvider(RPC_ENDPOINTS, {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )
  try {
    const service = new AttestationService(
      async () => client,
      async () => ({
        signer: identity.signer,
        origin: identity.address,
        publicKey: identity.publicKey
      }),
      false
    )
    if (BigInt(await service.identityOf(h160)) !== 0n) return
    const prefix = new TextEncoder().encode(BINDING_MESSAGE_PREFIX)
    const resolver = hexToBytes(ACTIVE_ATTESTATION_RESOLVER)
    const account = hexToBytes(h160)
    const message = new Uint8Array(prefix.length + resolver.length + account.length)
    message.set(prefix, 0)
    message.set(resolver, prefix.length)
    message.set(account, prefix.length + resolver.length)
    const signature = await identity.signer.signBytes(message)
    await service.bindIdentity(bytesToHex(identity.publicKey), bytesToHex(signature))
  } finally {
    try {
      client.destroy()
    } catch {
      // ignore teardown errors
    }
  }
}

/**
 * Sweep the per-run identity balances back to the master after a run so a fresh
 * identity does not strand native and PGAS. PGAS moves first because the native
 * transfer_all reaps the account. No-op locally where the identity is the master.
 */
export async function reclaimIdentity(): Promise<void> {
  const master = createMasterSigner()
  const identity = createProductSigner()
  if (identity.address === master.address) return
  await withAssetHubApi(async (api) => {
    const assetId = (await api.constants.Pgas.PgasAssetId()) as number
    const pgas = await pgasBalanceOf(api, assetId, identity.address)
    if (pgas > 0n) {
      await watchTxWithRetry(
        () =>
          api.tx.Assets.transfer({
            id: assetId,
            target: { type: 'Id', value: master.address as SS58String },
            amount: pgas
          }),
        identity.signer,
        'identity PGAS reclaim'
      ).catch((e) => console.error('identity PGAS reclaim failed:', e))
    }
    await watchTxWithRetry(
      () =>
        api.tx.Balances.transfer_all({
          dest: { type: 'Id', value: master.address as SS58String },
          keep_alive: false
        }),
      identity.signer,
      'identity native reclaim'
    ).catch((e) => console.error('identity native reclaim failed:', e))
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , toArg = 'Charlie', amountStr = String(DEFAULT_PGAS_AMOUNT)] = process.argv
  fundWithPgas(toArg, BigInt(amountStr))
    .then((r) => {
      console.log('[fundWithPgas] done', r)
      process.exit(0)
    })
    .catch((e: Error) => {
      console.error('[fundWithPgas] error', e)
      process.exit(1)
    })
}
