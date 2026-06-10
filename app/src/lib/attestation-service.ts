import { createAccountsProvider, hostApi } from '@novasamatech/host-api-wrapper'
import { contracts } from '@polkadot-api/descriptors'
import { type AsyncTransaction, createInkSdk } from '@polkadot-api/sdk-ink'
import { AccountId, type PolkadotClient, type PolkadotSigner, type SS58String } from 'polkadot-api'

import { ensureApi, ensureClient, type PaseoHubApi } from './client'
import { DUMMY_ORIGIN, NETWORK, PGAS_FUNDING_TIMEOUT, SELF_DOTNS } from './config'

export type ApiProvider = () => Promise<PaseoHubApi>
export type ClientProvider = () => Promise<PolkadotClient>
export type SignerProvider = () => Promise<{
  signer: PolkadotSigner
  origin: string
  publicKey: Uint8Array
}>

function bigStr(_: string, v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString()
  return v
}

async function hostSigner(): Promise<{
  signer: PolkadotSigner
  origin: string
  publicKey: Uint8Array
}> {
  const accountsProvider = createAccountsProvider()
  const accountResult = await accountsProvider.getProductAccount(SELF_DOTNS, 0)
  if (accountResult.isErr()) {
    throw new Error(accountResult.error.name ?? `getProductAccount failed for ${SELF_DOTNS}`)
  }
  const account = accountResult.value
  const publicKey = account.publicKey
  const origin = AccountId().dec(publicKey)
  return {
    signer: accountsProvider.getProductAccountSigner(account, 'createTransaction'),
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

// Memoise the ink SDK and contracts per network client. A provider rebuild yields fresh instances instead of ones stranded on
// the old, dead client.
/* eslint-disable @typescript-eslint/no-explicit-any */
const inkSdkByClient = new WeakMap<PolkadotClient, any>()
const contractByClient = new WeakMap<PolkadotClient, any>()
const resolverByClient = new WeakMap<PolkadotClient, any>()
/* eslint-enable @typescript-eslint/no-explicit-any */

export class AttestationService {
  constructor(
    private api: ApiProvider = ensureApi,
    private client: ClientProvider = ensureClient,
    private signer: SignerProvider = hostSigner,
    private truapi: boolean = true
  ) {}

  private async getSdk() {
    const client = await this.client()
    let sdk = inkSdkByClient.get(client)
    if (!sdk) {
      sdk = createInkSdk(client, { atBest: true })
      inkSdkByClient.set(client, sdk)
    }
    return sdk
  }

  private async getContract() {
    const client = await this.client()
    let contract = contractByClient.get(client)
    if (!contract) {
      contract = (await this.getSdk()).getContract(
        contracts.attestation_service,
        NETWORK.ATTESTATION_SERVICE
      )
      contractByClient.set(client, contract)
    }
    return contract
  }

  private async getResolver() {
    const client = await this.client()
    let resolver = resolverByClient.get(client)
    if (!resolver) {
      resolver = (await this.getSdk()).getContract(
        contracts.attestation_service,
        NETWORK.ATTESTATION_INDEX_RESOLVER
      )
      resolverByClient.set(client, resolver)
    }
    return resolver
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

    const attestArgs = {
      data: { request: { schema, data: { recipient, expirationTime, revocable, refId, data } } }
    }

    await this.ensureAllowance(origin)

    const dryRun = await contract.query('attest', {
      origin: origin as SS58String,
      ...attestArgs,
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!dryRun.success) {
      throw new Error(`attest dry-run failed: ${JSON.stringify(dryRun.value, bigStr)}`)
    }
    return this.submitTx(dryRun.value.send, signer, onPermitted)
  }

  async getSigner() {
    return this.signer()
  }

  async revoke(schema: bigint, id: bigint, onPermitted?: () => void): Promise<TxResult> {
    const { signer, origin } = await this.signer()
    const contract = await this.getContract()

    await this.ensureAllowance(origin)

    const dryRun = await contract.query('revoke', {
      origin: origin as SS58String,
      data: { request: { schema, data: { id } } },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })

    if (!dryRun.success) {
      throw new Error(`revoke dry-run failed: ${JSON.stringify(dryRun.value, bigStr)}`)
    }

    return this.submitTx(dryRun.value.send, signer, onPermitted)
  }

  /**
   * Provision the account PGAS allowance before a contract write.
   */
  private async ensureAllowance(origin: string): Promise<void> {
    // Pgas.PgasAssetId is checksum-stale in the typed descriptor, so read it via
    // the unsafe api; the typed api still serves the Assets.Account storage read.
    const api = await this.api()
    const unsafeApi = (await this.client()).getUnsafeApi()
    const pgasAssetId = (await unsafeApi.constants.Pgas.PgasAssetId()) as number
    const pgasAccount = await api.query.Assets.Account.getValue(pgasAssetId, origin as SS58String)
    const pgasBalance = pgasAccount?.balance ?? 0n
    if (pgasBalance > 0n) return

    if (!this.truapi) {
      throw new Error('NotEnoughFunds: account holds no PGAS and host coverage is unavailable.')
    }
    const allocated = await hostApi
      .requestResourceAllocation({
        tag: 'v1',
        value: [{ tag: 'SmartContractAllowance', value: 0 }]
      })
      .match(
        (res) => res.value.some((outcome) => outcome.tag === 'Allocated'),
        () => false
      )
    if (!allocated) {
      throw new Error('NotEnoughFunds: account holds no PGAS and the host declined PGAS coverage.')
    }

    // `Allocated` only means the host accepted the request.
    await this.waitForPgasFunded(pgasAssetId, origin)
  }

  /**
   * Poll until the account's PGAS balance is non-zero.
   */
  private async waitForPgasFunded(pgasAssetId: number, origin: string): Promise<void> {
    const api = await this.api()
    const POLL_MS = 1500
    const deadline = Date.now() + PGAS_FUNDING_TIMEOUT
    let remaining = PGAS_FUNDING_TIMEOUT
    while (remaining > 0) {
      const acct = await api.query.Assets.Account.getValue(pgasAssetId, origin as SS58String)
      if ((acct?.balance ?? 0n) > 0n) return
      await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, remaining)))
      remaining = deadline - Date.now()
    }
    // Surfaces as "Not enough allowance" via describeError.
    throw new Error('NotEnoughFunds: PGAS allowance did not fund in time')
  }

  private async submitTx(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: () => AsyncTransaction<any, any, any, any>,
    signer: PolkadotSigner,
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

    const tx = send()
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
        error: (err: Error) => {
          reject(err)
        }
      })
    })
  }
}

export const attestationService = new AttestationService()
