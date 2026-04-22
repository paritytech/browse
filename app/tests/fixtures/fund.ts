import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { MultiAddress, paseoHub } from '@polkadot-api/descriptors'
import { createClient, type SS58String } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws-provider/node'

export function createDevSigner(name: string) {
  const miniSecret = mnemonicToMiniSecret(DEV_PHRASE, '')
  const derive = sr25519CreateDerive(miniSecret)
  const wallet = derive(`//${name}`)
  return {
    signer: getPolkadotSigner(wallet.publicKey, 'Sr25519', async (input: Uint8Array) =>
      wallet.sign(input)
    ),
    address: ss58Encode(wallet.publicKey, 42),
    publicKey: wallet.publicKey
  }
}

const RPC_ENDPOINTS = [
  'wss://sys.ibp.network/asset-hub-paseo',
  'wss://asset-hub-paseo.dotters.network',
  'wss://asset-hub-paseo-rpc.dwellir.com'
]

// 10 PAS on Paseo Asset Hub (10 decimals) — enough to cover the contract's
// storage deposit across several attestations.
export const DEFAULT_TRANSFER_AMOUNT = 100_000_000_000n

// Threshold below which `fund` tops up the destination.
const MIN_FREE_BALANCE = 10_000_000_000n // 1 PAS

export interface TransferResult {
  from: string
  to: string
  amount: bigint
  txHash: string
  block: string
}

export interface FundResult {
  topUp: boolean
  toAddress: string
  freeBalance: bigint
  transfer?: TransferResult
}

export async function transfer(
  fromAccount: string,
  toAccount: string,
  amount: bigint
): Promise<TransferResult> {
  const from = createDevSigner(fromAccount)
  const to = createDevSigner(toAccount)
  const client = createClient(getWsProvider(RPC_ENDPOINTS))
  try {
    const api = client.getTypedApi(paseoHub)
    const tx = api.tx.Balances.transfer_keep_alive({
      dest: MultiAddress.Id(to.address as SS58String),
      value: amount
    })

    const result = await new Promise<{
      txHash: string
      block: string
      ok: boolean
      dispatchError?: unknown
    }>((resolve, reject) => {
      const sub = tx.signSubmitAndWatch(from.signer).subscribe({
        next: (event) => {
          if (event.type === 'txBestBlocksState' && event.found) {
            sub.unsubscribe()
            resolve({
              txHash: event.txHash,
              block: event.block.hash,
              ok: event.ok,
              dispatchError: event.ok ? undefined : event.dispatchError
            })
          }
        },
        error: reject
      })
    })

    if (!result.ok) {
      throw new Error(`transfer_keep_alive failed: ${JSON.stringify(result.dispatchError)}`)
    }
    return {
      from: from.address,
      to: to.address,
      amount,
      txHash: result.txHash,
      block: result.block
    }
  } finally {
    client.destroy()
  }
}

/**
 * Ensure `toAccount` has enough free balance for contract calls. Idempotent:
 * skips the transfer when the account is already above `MIN_FREE_BALANCE`.
 */
export async function fund(
  toAccount = 'Charlie',
  amount: bigint = DEFAULT_TRANSFER_AMOUNT
): Promise<FundResult> {
  const to = createDevSigner(toAccount)
  const client = createClient(getWsProvider(RPC_ENDPOINTS))
  let freeBalance: bigint
  try {
    const api = client.getTypedApi(paseoHub)
    const info = await api.query.System.Account.getValue(to.address as SS58String)
    freeBalance = info.data.free
  } finally {
    client.destroy()
  }

  if (freeBalance >= MIN_FREE_BALANCE) {
    return { topUp: false, toAddress: to.address, freeBalance }
  }

  const result = await transfer('Bob', toAccount, amount)
  return { topUp: true, toAddress: to.address, freeBalance, transfer: result }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , toArg = 'Charlie', amountStr = String(DEFAULT_TRANSFER_AMOUNT)] = process.argv
  fund(toArg, BigInt(amountStr))
    .then((r) => {
      console.log('[fund] done', r)
      process.exit(0)
    })
    .catch((e: Error) => {
      console.error('[fund] error', e)
      process.exit(1)
    })
}
