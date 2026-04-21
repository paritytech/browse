import { createAccountsProvider, hostApi, type ProductAccount } from '@novasamatech/product-sdk'
import { contracts } from '@polkadot-api/descriptors'
import {
  type AsyncTransaction,
  createReviveSdk,
  type ReviveSdkTypedApi
} from '@polkadot-api/sdk-ink'
import { type Binary, type PolkadotSigner, type SS58String } from 'polkadot-api'

import { ensureApi, type PaseoHubApi } from './client'
import { CONTRACTS, DUMMY_ORIGIN } from './config'

export type ApiProvider = () => Promise<PaseoHubApi>
export type SignerProvider = () => Promise<{
  signer: PolkadotSigner
  origin: string
  publicKey: Uint8Array
}>

async function hostSigner(): Promise<{
  signer: PolkadotSigner
  origin: string
  publicKey: Uint8Array
}> {
  const accountsProvider = createAccountsProvider()
  const accountsResult = await accountsProvider.getNonProductAccounts()
  if (accountsResult.isErr()) {
    throw new Error(accountsResult.error.name ?? 'Failed to get accounts')
  }
  const accounts = accountsResult.value
  if (accounts.length === 0) throw new Error('No accounts available')

  const account: ProductAccount = {
    dotNsIdentifier: '',
    derivationIndex: 0,
    publicKey: accounts[0].publicKey
  }
  return {
    signer: accountsProvider.getNonProductAccountSigner(account),
    origin: DUMMY_ORIGIN,
    publicKey: accounts[0].publicKey
  }
}

export type AttestationRecord = {
  attester: `0x${string}`
  recipient: `0x${string}`
  schema: bigint
  revoked: boolean
}

export type TxResult = { txHash: string; block: string }

const GAS = { ref_time: 10_000_000_000n, proof_size: 1_000_000n }
const STORAGE = 1_000_000_000_000n

export class AttestationService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private contractInstance: any = null

  constructor(
    private api: ApiProvider = ensureApi,
    private signer: SignerProvider = hostSigner,
    private truapi: boolean = true
  ) {}

  private async getContract() {
    if (!this.contractInstance) {
      const api = await this.api()
      this.contractInstance = createReviveSdk(
        api as unknown as ReviveSdkTypedApi,
        contracts.attestation_service,
        { atBest: true }
      ).getContract(CONTRACTS.ATTESTATION_SERVICE)
    }
    return this.contractInstance
  }

  async isActive(id: bigint): Promise<boolean> {
    const contract = await this.getContract()
    const result = await contract.query('isActive', {
      origin: DUMMY_ORIGIN as SS58String,
      data: { id },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('isActive dry-run failed')
    return result.value.response as boolean
  }

  async getSchemaRegistryAddress(): Promise<`0x${string}`> {
    const contract = await this.getContract()
    const result = await contract.query('getSchemaRegistry', {
      origin: DUMMY_ORIGIN as SS58String,
      data: {},
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('getSchemaRegistry dry-run failed')
    return result.value.response as `0x${string}`
  }

  async countByRecipientAndSchema(recipient: `0x${string}`, schema: bigint): Promise<bigint> {
    const contract = await this.getContract()
    const result = await contract.query('countByRecipientAndSchema', {
      origin: DUMMY_ORIGIN as SS58String,
      data: { recipient, schema },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('countByRecipientAndSchema dry-run failed')
    return result.value.response as bigint
  }

  async isActiveAny(
    recipient: `0x${string}`,
    schema: bigint,
    attesters: `0x${string}`[]
  ): Promise<boolean> {
    const contract = await this.getContract()
    const result = await contract.query('isActiveAny', {
      origin: DUMMY_ORIGIN as SS58String,
      data: { recipient, schema, attesters },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('isActiveAny dry-run failed')
    return result.value.response as boolean
  }

  async listByRecipientAndSchema(
    recipient: `0x${string}`,
    schema: bigint,
    offset: bigint,
    limit: bigint
  ): Promise<bigint[]> {
    const { origin } = await this.signer()
    const contract = await this.getContract()
    const result = await contract.query('listByRecipientAndSchema', {
      origin: origin as SS58String,
      data: { recipient, schema, offset, limit },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('listByRecipientAndSchema dry-run failed')
    return result.value.response as bigint[]
  }

  async getAttestationById(id: bigint): Promise<AttestationRecord> {
    const { origin } = await this.signer()
    const contract = await this.getContract()
    const result = await contract.query('getAttestationById', {
      origin: origin as SS58String,
      data: { id },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('getAttestationById dry-run failed')
    return result.value.response as AttestationRecord
  }

  async attest(
    schema: bigint,
    recipient: `0x${string}`,
    expirationTime: bigint,
    revocable: boolean,
    refId: bigint,
    data: Binary,
    onPermitted?: () => void
  ): Promise<TxResult> {
    const { signer, origin } = await this.signer()
    const contract = await this.getContract()

    const dryRun = await contract.query('attest', {
      origin: origin as SS58String,
      data: { request: { schema, data: { recipient, expirationTime, revocable, refId, data } } },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })

    const bigStr = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)
    if (!dryRun.success)
      throw new Error(`attest dry-run failed: ${JSON.stringify(dryRun.value, bigStr)}`)

    return this.submitTx(dryRun.value.send, signer, onPermitted)
  }

  async getSigner() {
    return this.signer()
  }

  async revoke(schema: bigint, id: bigint, onPermitted?: () => void): Promise<TxResult> {
    const { signer, origin } = await this.signer()
    const contract = await this.getContract()

    const dryRun = await contract.query('revoke', {
      origin: origin as SS58String,
      data: { request: { schema, data: { id } } },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })

    const bigStr = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)
    if (!dryRun.success)
      throw new Error(`revoke dry-run failed: ${JSON.stringify(dryRun.value, bigStr)}`)

    return this.submitTx(dryRun.value.send, signer, onPermitted)
  }

  private async submitTx(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: () => AsyncTransaction<any, any, any, any>,
    signer: PolkadotSigner,
    onPermitted?: () => void
  ): Promise<TxResult> {
    if (this.truapi) {
      const permitted = await hostApi
        .permission({ tag: 'v1', value: { tag: 'TransactionSubmit', value: undefined } })
        .match(
          (res) => res.value,
          () => false
        )
      if (!permitted) throw new Error('Transaction submit permission denied')
    }

    onPermitted?.()
    const tx = send()

    return new Promise((resolve, reject) => {
      tx.signSubmitAndWatch(signer).subscribe({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        next: (event: any) => {
          if (event.type === 'finalized') {
            resolve({ txHash: event.txHash ?? '', block: event.block?.hash ?? '' })
          } else if (event.type === 'txBestBlocksState' && event.found) {
            resolve({ txHash: event.txHash ?? '', block: event.block?.hash ?? '' })
          }
        },
        error: (err: Error) => reject(err)
      })
    })
  }
}

export const attestationService = new AttestationService()
