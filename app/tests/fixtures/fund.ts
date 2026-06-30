import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { createClient, type PolkadotClient, type SS58String } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { NETWORK } from '../../src/lib/config'
import { DEV_PHRASE as IDENTITY_PHRASE } from '../utils'

const RPC_ENDPOINTS = [...NETWORK.ASSETHUB_RPCS]
// Alice funds native top-ups (and PGAS where she holds it) on the dev networks.
const FUNDER = 'Alice'
export const DEFAULT_PGAS_AMOUNT = 5_000_000_000n
const MIN_PGAS_BALANCE = 1_000_000_000n
export const PGAS_MIN_BALANCE = 10_000_000n
const DEFAULT_NATIVE_AMOUNT = 1_000_000_000_000n
const MIN_NATIVE_BALANCE = 500_000_000_000n

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

export function createDevSigner(name: string) {
  return signerFor(mnemonicToMiniSecret(DEV_PHRASE, ''), `//${name}`)
}

/**
 * The product account the app attests with. The test host maps the product's
 * dotnsId ({@link LOCALHOST_SELF_DOTNS}) back to the signed-in host account via
 * `productAccounts` (see `startSignedHost`), so the attester is `smalltava.05`
 * `//wallet` account itself. The gated resolver only admits attestations from a
 * bound identity, so every seeded fixture attestation must use this account.
 */
export function createProductSigner() {
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
  await new Promise<void>((resolve, reject) => {
    api.tx.Assets.transfer({
      id: assetId,
      target: { type: 'Id', value: to as SS58String },
      amount
    })
      .signSubmitAndWatch(from.signer)
      .subscribe({
        next: (event) => {
          if (!((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized'))
            return
          if (event.ok === false) {
            reject(new Error(`PGAS transfer failed: ${JSON.stringify(event.dispatchError)}`))
          } else {
            resolve()
          }
        },
        error: reject
      })
  })
}

export interface FundResult {
  topUp: boolean
  toAddress: string
  pgasBalance: bigint
}

/**
 * Ensure dev account `toAccount` holds enough PGAS to pay for contract calls.
 * Idempotent: skips the transfer when already above `MIN_PGAS_BALANCE`. `from`
 * defaults to Alice. Pass {@link createProductSigner} to fund from the account
 * that actually holds PGAS on the dev networks (Alice has none there).
 */
export async function fundWithPgas(
  toAccount = 'Charlie',
  amount: bigint = DEFAULT_PGAS_AMOUNT,
  from: Credentials = createDevSigner(FUNDER)
): Promise<FundResult> {
  const to = createDevSigner(toAccount)
  return withAssetHubApi(async (api) => {
    const assetId = (await api.constants.Pgas.PgasAssetId()) as number
    const balance = await pgasBalanceOf(api, assetId, to.address)
    if (balance >= MIN_PGAS_BALANCE) {
      return { topUp: false, toAddress: to.address, pgasBalance: balance }
    }
    await transferPgas(api, assetId, from, to.address, amount)
    return {
      topUp: true,
      toAddress: to.address,
      pgasBalance: await pgasBalanceOf(api, assetId, to.address)
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
            if (!((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized'))
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
  to: string = createProductSigner().address
): Promise<void> {
  const from = createDevSigner(fromTag)
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
            if (!((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized'))
              return
            if (event.ok === false) {
              reject(new Error(`PGAS transfer_all failed: ${JSON.stringify(event.dispatchError)}`))
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
 * Send the entire native balance of `fromTag` to `to` and reap the account, so a
 * throwaway account does not permanently drain the funder. Defaults to the
 * funder. Call after every other tx the account signs, since it leaves nothing
 * for fees.
 */
export async function transferAllWithNative(
  fromTag: string,
  to: string = createDevSigner(FUNDER).address
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
            if (!((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized'))
              return
            if (event.ok === false) {
              reject(new Error(`native transfer_all failed: ${JSON.stringify(event.dispatchError)}`))
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
 * above `MIN_NATIVE_BALANCE`.
 */
export async function fundWithNative(
  toAddress: string,
  amount: bigint = DEFAULT_NATIVE_AMOUNT
): Promise<void> {
  await withAssetHubApi(async (api) => {
    const current = (await api.query.System.Account.getValue(toAddress as SS58String)) as {
      data?: { free?: bigint }
    }
    if ((current?.data?.free ?? 0n) >= MIN_NATIVE_BALANCE) return

    const funder = createDevSigner(FUNDER)
    await new Promise<void>((resolve, reject) => {
      api.tx.Balances.transfer_keep_alive({
        dest: { type: 'Id', value: toAddress as SS58String },
        value: amount
      })
        .signSubmitAndWatch(funder.signer)
        .subscribe({
          next: (event) => {
            if (!((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized'))
              return
            if (event.ok === false) {
              reject(new Error(`native transfer failed: ${JSON.stringify(event.dispatchError)}`))
            } else {
              resolve()
            }
          },
          error: reject
        })
    })
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
