import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { createClient, type SS58String } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { NETWORK } from '../../src/lib/config'

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

const RPC_ENDPOINTS = [...NETWORK.rpcs]

const PGAS_FUNDER = 'Alice'
export const DEFAULT_PGAS_AMOUNT = 5_000_000_000n
const MIN_PGAS_BALANCE = 1_000_000_000n

export interface FundResult {
  topUp: boolean
  toAddress: string
  pgasBalance: bigint
}

/**
 * Ensure `toAccount` holds enough PGAS to pay for contract calls. Idempotent:
 * skips the transfer when the account is already above `MIN_PGAS_BALANCE`.
 */
export async function fund(
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
    const readBalance = async (): Promise<bigint> => {
      const acct = (await api.query.Assets.Account.getValue(assetId, to.address as SS58String)) as
        | { balance?: bigint }
        | undefined
      return acct?.balance ?? 0n
    }

    const balance = await readBalance()
    if (balance >= MIN_PGAS_BALANCE) {
      return { topUp: false, toAddress: to.address, pgasBalance: balance }
    }

    const funder = createDevSigner(PGAS_FUNDER)
    const tx = api.tx.Assets.transfer({
      id: assetId,
      target: { type: 'Id', value: to.address as SS58String },
      amount
    })
    const result = await tx.signAndSubmit(funder.signer)
    if (!result.ok) {
      throw new Error(`PGAS transfer failed: ${JSON.stringify(result.dispatchError)}`)
    }
    return { topUp: true, toAddress: to.address, pgasBalance: await readBalance() }
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
