import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { createClient, type SS58String } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { NETWORK } from '../../src/lib/config'
import { DEV_PHRASE as IDENTITY_PHRASE } from '../utils'

const RPC_ENDPOINTS = [...NETWORK.ASSETHUB_RPCS]
// Alice funds both PGAS and native top-ups on the dev networks.
const FUNDER = 'Alice'
export const DEFAULT_PGAS_AMOUNT = 5_000_000_000n
const MIN_PGAS_BALANCE = 1_000_000_000n
const DEFAULT_NATIVE_AMOUNT = 10_000_000_000_000n
const MIN_NATIVE_BALANCE = 2_000_000_000_000n

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

export function createDevSigner(name: string) {
  return signerFor(mnemonicToMiniSecret(DEV_PHRASE, ''), `//${name}`)
}

/**
 * The product account the app attests with. The test host maps the product's
 * dotnsId ({@link LOCALHOST_SELF_DOTNS}) back to the signed-in host account via
 * `productAccounts` (see `startSignedHost`), so the attester is `smalltava.05`
 * `//wallet` account itself, the one that holds personhood. The gated resolver
 * only admits attestations from it, so every seeded fixture attestation must use
 * this account, not a plain dev account.
 */
export function createProductSigner() {
  return signerFor(mnemonicToMiniSecret(IDENTITY_PHRASE, ''), '//wallet')
}

export interface FundResult {
  topUp: boolean
  toAddress: string
  pgasBalance: bigint
}

/**
 * Ensure `toAccount` holds enough PGAS to pay for contract calls. Idempotent:
 * skips the transfer when the account is already above `MIN_PGAS_BALANCE`.
 */
export async function fundWithPgas(
  toAccount = 'Charlie',
  amount: bigint = DEFAULT_PGAS_AMOUNT
): Promise<FundResult> {
  const to = createDevSigner(toAccount)
  const client = createClient(
    getWsProvider(RPC_ENDPOINTS, {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )
  try {
    const api = client.getUnsafeApi()
    const assetId = (await api.constants.Pgas.PgasAssetId()) as number
    const readBalance = async (addr: string): Promise<bigint> => {
      const acct = (await api.query.Assets.Account.getValue(assetId, addr as SS58String)) as
        | { balance?: bigint }
        | undefined
      return acct?.balance ?? 0n
    }

    const funder = createDevSigner(FUNDER)
    const funderBalance = await readBalance(funder.address)
    const balance = await readBalance(to.address)

    if (balance >= MIN_PGAS_BALANCE) {
      return { topUp: false, toAddress: to.address, pgasBalance: balance }
    }

    if (funderBalance < amount) {
      console.error('[fundWithPgas] funder is out of gas', {
        funderPgas: funderBalance.toString(),
        needed: amount.toString()
      })
    }

    const tx = api.tx.Assets.transfer({
      id: assetId,
      target: { type: 'Id', value: to.address as SS58String },
      amount
    })
    const result = await tx.signAndSubmit(funder.signer)
    if (!result.ok) {
      throw new Error(`PGAS transfer failed: ${JSON.stringify(result.dispatchError)}`)
    }
    return { topUp: true, toAddress: to.address, pgasBalance: await readBalance(to.address) }
  } finally {
    try {
      client.destroy()
    } catch {
      // ignore teardown errors
    }
  }
}

/**
 * Ensure `toAddress` holds enough native token to pay tx fees. The identity
 * account signs fixture txs (reprove, seed attestations) with a plain signer
 * that pays fees in native, but it only holds PGAS, so it needs a native
 * top-up. Idempotent: skips when already above `MIN_NATIVE_BALANCE`.
 */
export async function fundWithNative(
  toAddress: string,
  amount: bigint = DEFAULT_NATIVE_AMOUNT
): Promise<void> {
  const client = createClient(
    getWsProvider(RPC_ENDPOINTS, {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )
  try {
    const api = client.getUnsafeApi()
    const current = (await api.query.System.Account.getValue(toAddress as SS58String)) as {
      data?: { free?: bigint }
    }
    if ((current?.data?.free ?? 0n) >= MIN_NATIVE_BALANCE) return

    const funder = createDevSigner(FUNDER)
    const tx = api.tx.Balances.transfer_keep_alive({
      dest: { type: 'Id', value: toAddress as SS58String },
      value: amount
    })
    const result = await tx.signAndSubmit(funder.signer)
    if (!result.ok) {
      throw new Error(`native transfer failed: ${JSON.stringify(result.dispatchError)}`)
    }
  } finally {
    try {
      client.destroy()
    } catch {
      // ignore teardown errors
    }
  }
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
