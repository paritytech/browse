import { createAccountsProvider, hostApi } from '@novasamatech/host-api-wrapper'
import { attestationVersions } from '@parity/browse-sdk'
import { contracts } from '@polkadot-api/descriptors'
import { type AsyncTransaction, createInkSdk, ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { AccountId, type PolkadotClient, type PolkadotSigner, type SS58String } from 'polkadot-api'
import { bytesToHex } from 'viem'

import { ensureApi, ensureClient, type PaseoHubApi } from './client'
import {
  ACTIVE_ATTESTATION_RESOLVER,
  DRY_RUN_WEIGHT_LIMIT,
  DUMMY_ORIGIN,
  NETWORK,
  PGAS_FUNDING_TIMEOUT,
  SELF_DOTNS
} from './config'
import { signIdentityMessage } from './identity-binding'

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

type AttestData = {
  request: {
    schema: bigint
    data: {
      recipient: `0x${string}`
      expirationTime: bigint
      revocable: boolean
      refId: bigint
      data: `0x${string}`
    }
  }
}

const GAS = DRY_RUN_WEIGHT_LIMIT
const STORAGE = 1_000_000_000_000n
const BATCH_CALL_GAS = { ref_time: 30_000_000_000n, proof_size: 3_000_000n }

// Memoised per client so a provider rebuild yields fresh instances, not ones
// stranded on the dead client.
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

  // Skip the on-chain bind re-check once bound this session.
  private identityBound = false

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

  // Resolver contracts cached per (client, address), so reads can union across
  // every deployed index-resolver version.
  private async getResolverAt(address: `0x${string}`) {
    const client = await this.client()
    let byAddress = resolverByClient.get(client)
    if (!byAddress) {
      byAddress = new Map()
      resolverByClient.set(client, byAddress)
    }
    let resolver = byAddress.get(address)
    if (!resolver) {
      resolver = (await this.getSdk()).getContract(contracts.attestation_service, address)
      byAddress.set(address, resolver)
    }
    return resolver
  }

  // The newest resolver, used for writes (attest/bindIdentity).
  private getResolver() {
    return this.getResolverAt(ACTIVE_ATTESTATION_RESOLVER)
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

  async countByRecipientAndSchema(recipient: `0x${string}`): Promise<bigint> {
    const counts = await Promise.all(
      attestationVersions(NETWORK).map(async ({ resolver, schemaId }) => {
        const contract = await this.getResolverAt(resolver)
        const result = await contract.query('countByRecipientAndSchema', {
          origin: DUMMY_ORIGIN as SS58String,
          data: { recipient, schema: schemaId },
          options: { gasLimit: GAS, storageDepositLimit: STORAGE }
        })
        if (!result.success) throw new Error('countByRecipientAndSchema dry-run failed')
        return result.value.response as bigint
      })
    )
    return counts.reduce((sum, c) => sum + c, 0n)
  }

  async countByAttester(attester: `0x${string}`): Promise<bigint> {
    const counts = await Promise.all(
      NETWORK.ATTESTATION_INDEX_RESOLVER.map(async (resolver) => {
        const contract = await this.getResolverAt(resolver)
        const result = await contract.query('countByAttester', {
          origin: DUMMY_ORIGIN as SS58String,
          data: { attester },
          options: { gasLimit: GAS, storageDepositLimit: STORAGE }
        })
        if (!result.success) throw new Error('countByAttester dry-run failed')
        return result.value.response as bigint
      })
    )
    return counts.reduce((sum, c) => sum + c, 0n)
  }

  async listByAttester(attester: `0x${string}`, offset: bigint, limit: bigint): Promise<bigint[]> {
    const lists = await Promise.all(
      NETWORK.ATTESTATION_INDEX_RESOLVER.map(async (resolver) => {
        const contract = await this.getResolverAt(resolver)
        const result = await contract.query('listByAttester', {
          origin: DUMMY_ORIGIN as SS58String,
          data: { attester, offset, limit },
          options: { gasLimit: GAS, storageDepositLimit: STORAGE }
        })
        if (!result.success) throw new Error('listByAttester dry-run failed')
        return result.value.response as bigint[]
      })
    )
    return lists.flat()
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

  async isActiveAny(recipient: `0x${string}`, attesters: `0x${string}`[]): Promise<boolean> {
    const results = await Promise.all(
      attestationVersions(NETWORK).map(async ({ resolver, schemaId }) => {
        const contract = await this.getResolverAt(resolver)
        const result = await contract.query('isActiveAny', {
          origin: DUMMY_ORIGIN as SS58String,
          data: { recipient, schema: schemaId, attesters },
          options: { gasLimit: GAS, storageDepositLimit: STORAGE }
        })
        if (!result.success) throw new Error('isActiveAny dry-run failed')
        return result.value.response as boolean
      })
    )
    return results.some(Boolean)
  }

  async listByRecipientAndSchema(
    recipient: `0x${string}`,
    offset: bigint,
    limit: bigint
  ): Promise<bigint[]> {
    const { origin } = await this.signer()
    const lists = await Promise.all(
      attestationVersions(NETWORK).map(async ({ resolver, schemaId }) => {
        const contract = await this.getResolverAt(resolver)
        const result = await contract.query('listByRecipientAndSchema', {
          origin: origin as SS58String,
          data: { recipient, schema: schemaId, offset, limit },
          options: { gasLimit: GAS, storageDepositLimit: STORAGE }
        })
        if (!result.success) throw new Error('listByRecipientAndSchema dry-run failed')
        return result.value.response as bigint[]
      })
    )
    return lists.flat()
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
    onBroadcast?: () => void
  ): Promise<TxResult> {
    const { signer, origin } = await this.signer()
    const attestData = {
      request: { schema, data: { recipient, expirationTime, revocable, refId, data } }
    }
    await this.ensureAllowance(origin)
    return this.submitAttest(origin, attestData, signer, onBroadcast)
  }

  /** Make a recommendation, binding the product account's identity first when the network requires it. */
  async recommend(
    schema: bigint,
    recipient: `0x${string}`,
    expirationTime: bigint,
    revocable: boolean,
    refId: bigint,
    data: `0x${string}`,
    onBroadcast?: () => void
  ): Promise<TxResult> {
    const { signer, origin } = await this.signer()
    const attestData = {
      request: { schema, data: { recipient, expirationTime, revocable, refId, data } }
    }

    await this.ensureAllowance(origin)

    // On a personhood-gated network the first recommendation from an unbound
    // account must bind its identity. Bundle the bind and attest into one atomic
    // batch so the user signs once, then memoise so later recommendations skip
    // the on-chain re-read. Ungated networks attest directly with no bind.
    if (NETWORK.ATTESTATION_GATED && !this.identityBound) {
      const account = await this.productH160()
      const existing = await this.boundIdentity(account)
      if (BigInt(existing) === 0n) {
        return this.bindAndAttest(account, attestData, signer, onBroadcast)
      }
      this.identityBound = true
    }

    return this.submitAttest(origin, attestData, signer, onBroadcast)
  }

  /** Dry-run and submit a single attest. */
  private async submitAttest(
    origin: string,
    attestData: AttestData,
    signer: PolkadotSigner,
    onBroadcast?: () => void
  ): Promise<TxResult> {
    const contract = await this.getContract()
    const dryRun = await contract.query('attest', {
      origin: origin as SS58String,
      data: attestData,
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!dryRun.success) {
      throw new Error(`attest dry-run failed: ${JSON.stringify(dryRun.value, bigStr)}`)
    }
    return this.submitTx(dryRun.value.send, signer, onBroadcast)
  }

  /**
   * Bind the product account to its identity and attest in one atomic
   * `Utility.batch_all`, so the user signs once. The post-bind attest can't be
   * dry-run (its standalone dry-run reverts while unbound), so both calls use a
   * bounded gas limit.
   */
  private async bindAndAttest(
    account: `0x${string}`,
    attestData: AttestData,
    signer: PolkadotSigner,
    onBroadcast?: () => void
  ): Promise<TxResult> {
    const { pubKey, signature } = await signIdentityMessage(ACTIVE_ATTESTATION_RESOLVER, account)
    const resolver = await this.getResolver()
    const contract = await this.getContract()
    // sdk-ink's `.decodedCall` is a Promise (the tx is built asynchronously),
    // so await both before wrapping them in Utility.batch_all. Otherwise the
    // batch arg holds Promises and fails papi's runtime compatibility check.
    const bindCall = await resolver.send('bindIdentity', {
      data: { pubKey: bytesToHex(pubKey), signature: bytesToHex(signature) },
      gasLimit: BATCH_CALL_GAS,
      storageDepositLimit: STORAGE
    }).decodedCall
    const attestCall = await contract.send('attest', {
      data: attestData,
      gasLimit: BATCH_CALL_GAS,
      storageDepositLimit: STORAGE
    }).decodedCall

    const api = await this.api()
    const batch = api.tx.Utility.batch_all({ calls: [bindCall, attestCall] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const send = () => batch as unknown as AsyncTransaction<any, any, any, any>
    const result = await this.submitTx(send, signer, onBroadcast)
    this.identityBound = true
    return result
  }

  async getSigner() {
    return this.signer()
  }

  /** The product account's EVM H160 (the on-chain attester / bindIdentity caller). */
  private async productH160(): Promise<`0x${string}`> {
    const { publicKey } = await this.signer()
    const ss58 = AccountId().dec(publicKey) as SS58String
    return ss58ToEthereum(ss58).toLowerCase() as `0x${string}`
  }

  /** Returns the identity account a product account is bound to, or the zero address. */
  async boundIdentity(account: `0x${string}`): Promise<`0x${string}`> {
    const resolver = await this.getResolver()
    const result = await resolver.query('boundIdentity', {
      origin: DUMMY_ORIGIN as SS58String,
      data: { account },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) throw new Error('boundIdentity dry-run failed')
    return result.value.response as `0x${string}`
  }

  async revoke(schema: bigint, id: bigint, onBroadcast?: () => void): Promise<TxResult> {
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

    return this.submitTx(dryRun.value.send, signer, onBroadcast)
  }

  /**
   * Provision the account PGAS allowance before a contract write.
   */
  private async ensureAllowance(origin: string): Promise<void> {
    // Pgas.PgasAssetId is checksum-stale in the typed descriptor, so read it via
    // the unsafe api. The typed api still serves the Assets.Account storage read.
    const api = await this.api()
    const unsafeApi = (await this.client()).getUnsafeApi()
    const pgasAssetId = (await unsafeApi.constants.Pgas.PgasAssetId()) as number
    const pgasAccount = await api.query.Assets.Account.getValue(pgasAssetId, origin as SS58String, {
      at: 'best'
    })
    const pgasBalance = pgasAccount?.balance ?? 0n
    if (pgasBalance > 0n) return

    if (!this.truapi) {
      throw new Error('NotEnoughFunds: account holds no PGAS and host coverage is unavailable.')
    }
    const resources = [{ tag: 'SmartContractAllowance' as const, value: 0 }]
    const outcomes = await hostApi.requestResourceAllocation({ tag: 'v1', value: resources }).match(
      (res) => res.value,
      () => []
    )
    if (outcomes[0]?.tag !== 'Allocated') {
      throw new Error('NotEnoughFunds: account holds no PGAS and the host declined PGAS coverage.')
    }

    // `Allocated` only means the host accepted the request. The claim takes a
    // few seconds to actually mint PGAS into the account. The contract write
    // pays its fee in PGAS, so submitting before the balance lands fails with
    // `Invalid: Payment`. Block here until the account is funded.
    await this.waitForPgasFunded(pgasAssetId, origin)
  }

  private async waitForPgasFunded(pgasAssetId: number, origin: string): Promise<void> {
    const api = await this.api()
    const POLL_MS = 1000
    const deadline = Date.now() + PGAS_FUNDING_TIMEOUT
    while (Date.now() < deadline) {
      const acct = await api.query.Assets.Account.getValue(pgasAssetId, origin as SS58String, {
        at: 'best'
      })
      if ((acct?.balance ?? 0n) > 0n) return
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
    throw new Error('NotEnoughFunds: PGAS allowance did not fund in time')
  }

  private async submitTx(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: () => AsyncTransaction<any, any, any, any>,
    signer: PolkadotSigner,
    onBroadcast?: () => void
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

    return new Promise((resolve, reject) => {
      tx.signSubmitAndWatch(signer).subscribe({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        next: (event: any) => {
          if (event.type === 'broadcasted') {
            onBroadcast?.()
          } else if (
            event.type === 'finalized' ||
            (event.type === 'txBestBlocksState' && event.found)
          ) {
            // A tx can be included yet revert. `ok === false` carries the
            // dispatch error. Treating that as success hides on-chain failures.
            if (event.ok === false) {
              reject(
                new Error(
                  `Transaction reverted: ${JSON.stringify(event.dispatchError ?? {}, bigStr)}`
                )
              )
              return
            }
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
