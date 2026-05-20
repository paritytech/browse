import { createAccountsProvider, hostApi } from '@novasamatech/product-sdk'
import { contracts } from '@polkadot-api/descriptors'
import { type AsyncTransaction, createInkSdk } from '@polkadot-api/sdk-ink'
import {
  AccountId,
  Binary,
  type PolkadotClient,
  type PolkadotSigner,
  type SS58String
} from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'

import { ensureApi, ensureClient, type PaseoHubApi } from './client'
import { BACKEND, DUMMY_ORIGIN } from './config'

export type ApiProvider = () => Promise<PaseoHubApi>
export type ClientProvider = () => Promise<PolkadotClient>
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
  const accountsResult = await accountsProvider.getLegacyAccounts()
  if (accountsResult.isErr()) {
    throw new Error(accountsResult.error.name ?? 'Failed to get accounts')
  }
  const accounts = accountsResult.value
  if (accounts.length === 0) throw new Error('No accounts available')

  const account = accounts[0]
  const publicKey = account.publicKey
  const origin = AccountId().dec(publicKey)

  const signBytes = async (data: Uint8Array): Promise<Uint8Array> => {
    const result = await hostApi.signRawWithLegacyAccount({
      tag: 'v1',
      value: { signer: origin, payload: { tag: 'Bytes', value: data } }
    })
    return result.match(
      (res) => {
        const sig = res.value.signature
        return typeof sig === 'string' ? Binary.fromHex(sig as `0x${string}`) : sig
      },
      (err) => {
        const v = err.value as { name?: string; reason?: string } | undefined
        const msg = [v?.name, v?.reason].filter(Boolean).join(': ')
        throw new Error(msg || 'signRawWithLegacyAccount failed')
      }
    )
  }

  return {
    signer: getPolkadotSigner(publicKey, 'Sr25519', signBytes),
    origin,
    publicKey
  }
}

export type AttestationRecord = {
  id: bigint
  schema: bigint
  time: bigint
  expirationTime: bigint
  revocationTime: bigint
  refId: bigint
  recipient: `0x${string}`
  attester: `0x${string}`
  revocable: boolean
  data: `0x${string}`
}

export type TxResult = { txHash: string; block: string }

const GAS = { ref_time: 10_000_000_000n, proof_size: 1_000_000n }
const STORAGE = 1_000_000_000_000n

export class AttestationService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdkInstance: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private contractInstance: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolverInstance: any = null

  constructor(
    private api: ApiProvider = ensureApi,
    private client: ClientProvider = ensureClient,
    private signer: SignerProvider = hostSigner,
    private truapi: boolean = true
  ) {}

  private async getSdk() {
    if (!this.sdkInstance) {
      const client = await this.client()
      this.sdkInstance = createInkSdk(client, { atBest: true })
    }
    return this.sdkInstance
  }

  private async getContract() {
    if (!this.contractInstance) {
      const sdk = await this.getSdk()
      this.contractInstance = sdk.getContract(
        contracts.attestation_service,
        BACKEND.ATTESTATION_SERVICE
      )
    }
    return this.contractInstance
  }

  private async getResolver() {
    if (!this.resolverInstance) {
      const sdk = await this.getSdk()
      this.resolverInstance = sdk.getContract(
        contracts.attestation_service,
        BACKEND.ATTESTATION_INDEX_RESOLVER
      )
    }
    return this.resolverInstance
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
    const contract = await this.getResolver()
    const result = await contract.query('countByRecipientAndSchema', {
      origin: DUMMY_ORIGIN as SS58String,
      data: { recipient, schema },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('countByRecipientAndSchema dry-run failed')
    return result.value.response as bigint
  }

  async countByAttester(attester: `0x${string}`): Promise<bigint> {
    const contract = await this.getResolver()
    const result = await contract.query('countByAttester', {
      origin: DUMMY_ORIGIN as SS58String,
      data: { attester },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('countByAttester dry-run failed')
    return result.value.response as bigint
  }

  async listByAttester(attester: `0x${string}`, offset: bigint, limit: bigint): Promise<bigint[]> {
    const contract = await this.getResolver()
    const result = await contract.query('listByAttester', {
      origin: DUMMY_ORIGIN as SS58String,
      data: { attester, offset, limit },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('listByAttester dry-run failed')
    return result.value.response as bigint[]
  }

  async getAttestationByIds(ids: bigint[]): Promise<AttestationRecord[]> {
    const contract = await this.getContract()
    const result = await contract.query('getAttestationByIds', {
      origin: DUMMY_ORIGIN as SS58String,
      data: { ids },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('getAttestationByIds dry-run failed')
    return result.value.response as AttestationRecord[]
  }

  async isActiveAny(
    recipient: `0x${string}`,
    schema: bigint,
    attesters: `0x${string}`[]
  ): Promise<boolean> {
    const contract = await this.getResolver()
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
    const contract = await this.getResolver()
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
    data: `0x${string}`,
    onPermitted?: () => void
  ): Promise<TxResult> {
    const { signer, origin } = await this.signer()
    const contract = await this.getContract()
    const sdk = await this.getSdk()
    const isMapped = await sdk.addressIsMapped(origin as SS58String)

    const attestArgs = {
      data: { request: { schema, data: { recipient, expirationTime, revocable, refId, data } } }
    }

    if (isMapped) {
      const dryRun = await contract.query('attest', {
        origin: origin as SS58String,
        ...attestArgs,
        options: { gasLimit: GAS, storageDepositLimit: STORAGE }
      })
      const bigStr = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)
      if (!dryRun.success)
        throw new Error(`attest dry-run failed: ${JSON.stringify(dryRun.value, bigStr)}`)
      const storageDeposit = (dryRun.value as { storageDeposit?: bigint }).storageDeposit ?? 0n
      return this.submitTx(dryRun.value.send, signer, origin, storageDeposit, onPermitted)
    }

    const api = await this.api()
    const attestTx = contract.send('attest', {
      ...attestArgs,
      gasLimit: GAS,
      storageDepositLimit: STORAGE
    })
    const attestCall = await attestTx.decodedCall
    const mapCall = api.tx.Revive.map_account().decodedCall
    const batchTx = api.tx.Utility.batch_all({ calls: [mapCall, attestCall] })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.submitTx(() => batchTx as any, signer, origin, 0n, onPermitted)
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

    const storageDeposit = (dryRun.value as { storageDeposit?: bigint }).storageDeposit ?? 0n
    return this.submitTx(dryRun.value.send, signer, origin, storageDeposit, onPermitted)
  }

  private async submitTx(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: () => AsyncTransaction<any, any, any, any>,
    signer: PolkadotSigner,
    origin: string,
    storageDeposit: bigint,
    onPermitted?: () => void
  ): Promise<TxResult> {
    if (this.truapi) {
      const permitted = await hostApi
        .permission({ tag: 'v1', value: { tag: 'ChainSubmit', value: undefined } })
        .match(
          (res) => res.value,
          () => false
        )
      if (!permitted) throw new Error('Transaction submit permission denied')
    }

    const api = await this.api()
    const accountInfo = await api.query.System.Account.getValue(origin as SS58String)
    const free = accountInfo.data.free

    const tx = send()
    let estimatedFees = 0n
    try {
      estimatedFees = await tx.getEstimatedFees(origin as SS58String)
    } catch {
      // fall back to 0
    }
    const totalNeeded = storageDeposit + estimatedFees

    if (free < totalNeeded) {
      if (!this.truapi) {
        throw new Error(
          `NotEnoughFunds: need ${totalNeeded} (fees ${estimatedFees} + storage ${storageDeposit}), have ${free}.`
        )
      }
      const allocated = await hostApi
        .requestResourceAllocation({
          tag: 'v1',
          value: [{ tag: 'SmartContractAllowance', value: 0 }]
        })
        .match(
          (res) => res.value.some((o) => o.tag === 'Allocated'),
          () => false
        )
      if (!allocated) {
        throw new Error(
          `NotEnoughFunds: need ${totalNeeded} (fees ${estimatedFees} + storage ${storageDeposit}), have ${free} and the host declined PGAS coverage.`
        )
      }
    }

    onPermitted?.()

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
