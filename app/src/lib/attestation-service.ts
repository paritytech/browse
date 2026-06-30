import { createAccountsProvider, hostApi } from '@novasamatech/host-api-wrapper'
import { attestationVersions } from '@parity/browse-sdk'
import { contracts } from '@polkadot-api/descriptors'
import { type AsyncTransaction, createInkSdk, ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { AccountId, type PolkadotClient, type PolkadotSigner, type SS58String } from 'polkadot-api'
import { bytesToHex } from 'viem'

import { endTransaction, ensureClient, resetBrowseSdk, startTransaction } from './client'
import {
  ACTIVE_ATTESTATION_RESOLVER,
  DRY_RUN_WEIGHT_LIMIT,
  DUMMY_ORIGIN,
  NETWORK,
  PGAS_FUNDING_TIMEOUT,
  SELF_DOTNS
} from './config'
import { signIdentityMessage } from './identity-binding'

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

/**
 * A `ChainHead disjointed` surfaces when a concurrent `resetBrowseSdk` destroys
 * the shared client mid-operation.
 */
function isChainDisjoint(err: unknown): boolean {
  // `String(err)` includes the Error name and message, so this covers both
  // `DisjointError` and a `ChainHead disjointed` message.
  return /disjoint/i.test(String(err))
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

const GAS = DRY_RUN_WEIGHT_LIMIT
const STORAGE = 1_000_000_000_000n

// Gas cap for the batched attest. It can't be dry-run while the account is
// unbound, so we cap it instead of measuring. Generous but block-bounded, and
// matches the proven evm/scripts Revive.call limit. batch_all is atomic, so an
// undercap (or any failure) reverts the whole batch rather than half-binding.
const CALL_WEIGHT = { ref_time: 10_000_000_000n, proof_size: 1_000_000n }

// Memoised per client so a provider rebuild yields fresh instances, not ones
// stranded on the dead client.
/* eslint-disable @typescript-eslint/no-explicit-any */
const inkSdkByClient = new WeakMap<PolkadotClient, any>()
const contractByClient = new WeakMap<PolkadotClient, any>()
const resolverByClient = new WeakMap<PolkadotClient, any>()
/* eslint-enable @typescript-eslint/no-explicit-any */

export class AttestationService {
  constructor(
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

  /**
   * Submit a single attestation. Assumes the attester is
   * already bound to its identity.
   */
  async attest(
    schema: bigint,
    recipient: `0x${string}`,
    expirationTime: bigint,
    revocable: boolean,
    refId: bigint,
    data: `0x${string}`,
    onBroadcast?: () => void
  ): Promise<TxResult> {
    return this.withTransactionRetry(async (track) => {
      const { signer, origin } = await this.signer()
      const attestData = {
        request: { schema, data: { recipient, expirationTime, revocable, refId, data } }
      }
      await this.ensureAllowance(origin)

      const contract = await this.getContract()
      const dryRun = await contract.query('attest', {
        origin: origin as SS58String,
        data: attestData,
        options: { gasLimit: GAS, storageDepositLimit: STORAGE }
      })
      if (!dryRun.success) {
        const detail = JSON.stringify(dryRun.value, bigStr)
        // The resolver refuses a second recommendation from the same identity by
        // reverting with AttestationService__ResolverRejected().
        const rejectedSelector = [0xad, 0x0d, 0x91, 0xb9].map((b, i) => `"${i}":${b}`).join(',')
        if (detail.includes(rejectedSelector)) {
          throw new Error('AttestationService__ResolverRejected')
        }
        throw new Error(`attest dry-run failed: ${detail}`)
      }
      return this.submitTx(dryRun.value.send, signer, track)
    }, onBroadcast)
  }

  /**
   * Run a write, recovering from a `ChainHead disjointed` thrown when a
   * concurrent `resetBrowseSdk` destroys the shared client. Resets and retries
   * on a fresh client, but only before the tx broadcasts so a settled
   * submission is never re-sent.
   */
  private async withTransactionRetry(
    run: (onBroadcast: () => void) => Promise<TxResult>,
    onBroadcast?: () => void
  ): Promise<TxResult> {
    let broadcasted = false
    const track = () => {
      broadcasted = true
      onBroadcast?.()
    }
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; ; attempt++) {
      // Bracket the attempt so an unrelated reset (foreground, background sync)
      // is deferred instead of yanking the client mid-write.
      startTransaction()
      try {
        return await run(track)
      } catch (err) {
        if (broadcasted || attempt >= MAX_ATTEMPTS || !isChainDisjoint(err)) throw err
        // Fall through to reset and retry once the bracket is released below.
      } finally {
        endTransaction()
      }
      resetBrowseSdk()
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }

  /**
   * Bind the product account to its identity and attest in one signature, as an
   * atomic `Utility.batch_all([bindIdentity, attest])` (the first recommendation
   * from an unbound account). A failed attest reverts the bind too, so the
   * account is never left bound but not recommended.
   *
   * The attest can't be dry-run while unbound (its `onAttest` gate checks the
   * binding the batch sets), so it takes a bounded gas cap while the bind is
   * dry-run for an accurate weight.
   */
  async bindIdentityAndAttest(
    schema: bigint,
    recipient: `0x${string}`,
    expirationTime: bigint,
    revocable: boolean,
    refId: bigint,
    data: `0x${string}`,
    onBroadcast?: () => void
  ): Promise<TxResult> {
    return this.withTransactionRetry(async (track) => {
      const { signer, origin } = await this.signer()
      const account = await this.productH160()
      const attestData = {
        request: { schema, data: { recipient, expirationTime, revocable, refId, data } }
      }
      await this.ensureAllowance(origin)

      // Build the inner calls with sdk-ink so the nested call codec matches the
      // runtime. A raw `Revive.call` fails the Utility sign-time check.
      const { pubKey, signature } = await signIdentityMessage(ACTIVE_ATTESTATION_RESOLVER, account)
      const resolver = await this.getResolver()
      const bindDry = await resolver.query('bindIdentity', {
        origin: origin as SS58String,
        data: { pubKey: bytesToHex(pubKey), signature: bytesToHex(signature) },
        options: { gasLimit: GAS, storageDepositLimit: STORAGE }
      })
      if (!bindDry.success) {
        throw new Error(`bindIdentity dry-run failed: ${JSON.stringify(bindDry.value, bigStr)}`)
      }
      const contract = await this.getContract()
      const bindCall = await bindDry.value.send().decodedCall
      const attestCall = await contract.send('attest', {
        data: attestData,
        gasLimit: CALL_WEIGHT,
        storageDepositLimit: STORAGE
      }).decodedCall

      const api = (await this.client()).getUnsafeApi()
      const batch = api.tx.Utility.batch_all({ calls: [bindCall, attestCall] })
      return this.submitTx(() => batch as never, signer, track)
    }, onBroadcast)
  }

  async getSigner() {
    return this.signer()
  }

  /** The product account EVM H160 (the on-chain attester and bindIdentity caller). */
  async productH160(): Promise<`0x${string}`> {
    const { publicKey } = await this.signer()
    const ss58 = AccountId().dec(publicKey) as SS58String
    return ss58ToEthereum(ss58).toLowerCase() as `0x${string}`
  }

  /**
   * Bind the signing product account to the identity that signed `signature`
   * over the binding message (the resolver's `bindIdentity`). The app does this
   * as part of {@link bindIdentityAndAttest}; this standalone submit is for
   * callers that hold the identity signature directly.
   */
  async bindIdentity(
    pubKey: `0x${string}`,
    signature: `0x${string}`,
    onBroadcast?: () => void
  ): Promise<TxResult> {
    return this.withTransactionRetry(async (track) => {
      const { signer, origin } = await this.signer()
      await this.ensureAllowance(origin)
      const resolver = await this.getResolver()
      const dryRun = await resolver.query('bindIdentity', {
        origin: origin as SS58String,
        data: { pubKey, signature },
        options: { gasLimit: GAS, storageDepositLimit: STORAGE }
      })
      if (!dryRun.success) {
        throw new Error(`bindIdentity dry-run failed: ${JSON.stringify(dryRun.value, bigStr)}`)
      }
      return this.submitTx(dryRun.value.send, signer, track)
    }, onBroadcast)
  }

  /** Returns the identity account a product account is bound to, or the zero address. */
  async boundIdentity(account: `0x${string}`): Promise<`0x${string}`> {
    const resolver = await this.getResolver()
    const result = await resolver.query('boundIdentity', {
      origin: DUMMY_ORIGIN as SS58String,
      data: { account },
      options: { gasLimit: GAS, storageDepositLimit: STORAGE }
    })
    if (!result.success) {
      throw new Error(`boundIdentity dry-run failed: ${JSON.stringify(result.value, bigStr)}`)
    }
    return result.value.response as `0x${string}`
  }

  async revoke(schema: bigint, id: bigint, onBroadcast?: () => void): Promise<TxResult> {
    return this.withTransactionRetry(async (track) => {
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
      return this.submitTx(dryRun.value.send, signer, track)
    }, onBroadcast)
  }

  /**
   * Ensure the product account can pay for a contract write via a
   * SmartContractAllowance grant (RFC-0010).
   *
   * Request it only when the PGAS balance is zero. A non-zero balance means the
   * account is already provisioned, and re-requesting re-prompts the user every
   * time. The grant authorizes the `AsPgas` fee route rather than minting a
   * balance, so do not wait for one after `Allocated`. Without the grant,
   * `createTransaction` fails with `CreateTransactionErr::PermissionDenied`.
   */
  private async ensureAllowance(origin: string): Promise<void> {
    // Pgas.PgasAssetId is checksum-stale in the typed descriptor, so read it and
    // the Assets.Account balance via the unsafe api.
    const unsafeApi = (await this.client()).getUnsafeApi()
    const pgasAssetId = (await unsafeApi.constants.Pgas.PgasAssetId()) as number
    const pgasAccount = (await unsafeApi.query.Assets.Account.getValue(pgasAssetId, origin, {
      at: 'best'
    })) as { balance?: bigint } | undefined
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
    const outcome = outcomes[0]?.tag
    if (outcome !== 'Allocated') {
      throw new Error(
        `NotEnoughFunds: SmartContractAllowance not granted (outcome: ${outcome ?? 'none'})`
      )
    }

    // `Allocated` only means the host accepted the request. The claim takes a
    // few seconds to actually mint PGAS into the account. The contract write
    // pays its fee in PGAS, so submitting before the balance lands fails with
    // `Invalid: Payment`. Block here until the account is funded.
    await this.waitForPgasFunded(pgasAssetId, origin)
  }

  private async waitForPgasFunded(pgasAssetId: number, origin: string): Promise<void> {
    const unsafeApi = (await this.client()).getUnsafeApi()
    const POLL_MS = 1000
    const deadline = Date.now() + PGAS_FUNDING_TIMEOUT
    while (Date.now() < deadline) {
      const acct = (await unsafeApi.query.Assets.Account.getValue(pgasAssetId, origin, {
        at: 'best'
      })) as { balance?: bigint } | undefined
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
