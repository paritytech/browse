import { keccak_256 } from '@noble/hashes/sha3.js'
import { createAccountsProvider, type ProductAccount } from '@novasamatech/product-sdk'
import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { Binary, FixedSizeBinary, type PolkadotSigner } from 'polkadot-api'

import { type MulticallTarget, namehash, nodeToSubject } from './abi'
import { ensureApi, reviveCall } from './client'
import { CONTRACTS, DUMMY_ORIGIN } from './config'
import { multicall } from './multicall'
import { type AppEntry } from '../state/apps/types'

const REGISTRY = CONTRACTS.ATTESTATION_REGISTRY

function toHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

function stripPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}

function pad32(hex: string): string {
  return stripPrefix(hex).padStart(64, '0')
}

function selectorHash(sig: string): string {
  const hash = keccak_256(new TextEncoder().encode(sig))
  return toHex(hash.slice(0, 4)).slice(2)
}

export const SCHEMA_FAVOURITE = toHex(keccak_256(new TextEncoder().encode('browse.favourite.v1')))

const SEL = {
  attest: selectorHash('attest(address,bytes32,bytes32,uint64)'),
  count: selectorHash('count(address)'),
  isValid: selectorHash('isValid(address,bytes32,address)'),
  isValidAny: selectorHash('isValidAny(address,bytes32,address[])'),
  get: selectorHash('get(address,bytes32,address)'),
  revoke: selectorHash('revoke(address,bytes32)')
} as const

export function encodeAttest(
  subject: `0x${string}`,
  schema: `0x${string}`,
  value: `0x${string}`,
  expiry: bigint
): `0x${string}` {
  return `0x${SEL.attest}${pad32(subject)}${pad32(schema)}${pad32(value)}${pad32(expiry.toString(16))}` as `0x${string}`
}

export function encodeRevoke(subject: `0x${string}`, schema: `0x${string}`): `0x${string}` {
  return `0x${SEL.revoke}${pad32(subject)}${pad32(schema)}` as `0x${string}`
}

function encodeIsValidAny(
  subject: `0x${string}`,
  schema: `0x${string}`,
  attesters: string[]
): `0x${string}` {
  const n = attesters.length
  const offset = pad32('60')
  const arrayLen = pad32(String(n))
  const addrs = attesters.map((a) => pad32(a)).join('')
  return `0x${SEL.isValidAny}${pad32(subject)}${pad32(schema)}${offset}${arrayLen}${addrs}` as `0x${string}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UnsafeApi = any

export type ApiProvider = () => Promise<UnsafeApi>
export type SignerProvider = () => Promise<{ signer: PolkadotSigner; origin: string }>

async function hostSigner(): Promise<{ signer: PolkadotSigner; origin: string }> {
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
    origin: DUMMY_ORIGIN
  }
}

export class AttestationRegistryService {
  constructor(
    private api: ApiProvider = ensureApi,
    private signer: SignerProvider = hostSigner
  ) {}

  private getApi() {
    return this.api()
  }

  private getSigner() {
    return this.signer()
  }

  async count(subject: `0x${string}`): Promise<number> {
    const data = `0x${SEL.count}${pad32(subject)}` as `0x${string}`
    const result = await reviveCall(REGISTRY, data)
    const hex = stripPrefix(result)
    return Number(BigInt('0x' + hex.slice(48, 64)))
  }

  async isValid(
    subject: `0x${string}`,
    schema: `0x${string}`,
    attester: `0x${string}`
  ): Promise<boolean> {
    const data =
      `0x${SEL.isValid}${pad32(subject)}${pad32(schema)}${pad32(attester)}` as `0x${string}`
    const result = await reviveCall(REGISTRY, data)
    return parseInt(stripPrefix(result), 16) !== 0
  }

  async isValidAny(
    subject: `0x${string}`,
    schema: `0x${string}`,
    attesters: `0x${string}`[]
  ): Promise<boolean> {
    const n = attesters.length
    const offset = pad32('60')
    const arrayLen = pad32(String(n))
    const addrs = attesters.map((a) => pad32(a)).join('')
    const data =
      `0x${SEL.isValidAny}${pad32(subject)}${pad32(schema)}${offset}${arrayLen}${addrs}` as `0x${string}`
    const result = await reviveCall(REGISTRY, data)
    return parseInt(stripPrefix(result), 16) !== 0
  }

  async getFollowedApps(apps: AppEntry[], contacts: string[]): Promise<Set<string>> {
    if (contacts.length === 0 || apps.length === 0) return new Set()

    const h160Contacts = contacts.map((ss58) => ss58ToEthereum(ss58).asHex() as string)

    const calls: MulticallTarget[] = apps.map((app) => {
      const node = namehash(`${app.label}.dot`)
      const subject = nodeToSubject(node) as `0x${string}`
      return {
        target: REGISTRY,
        callData: encodeIsValidAny(subject, SCHEMA_FAVOURITE as `0x${string}`, h160Contacts)
      }
    })

    const results = await multicall(calls)
    const matched = new Set<string>()
    for (let i = 0; i < apps.length; i++) {
      if (results[i]?.success && parseInt(stripPrefix(results[i].returnData), 16) !== 0) {
        matched.add(apps[i].label)
      }
    }
    return matched
  }

  private async submitTx(calldata: `0x${string}`): Promise<{ txHash: string; block: string }> {
    const { signer, origin } = await this.getSigner()
    const api = await this.getApi()

    const dryRun = (await api.apis.ReviveApi.call(
      origin,
      Binary.fromHex(REGISTRY as `0x${string}`),
      0n,
      undefined,
      undefined,
      Binary.fromHex(calldata)
    )) as Record<string, unknown>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dryRunResult = (dryRun as any).result
    const ok = dryRunResult?.value ?? dryRunResult?.ok ?? null
    if (!ok) throw new Error('Dry-run failed: no result')

    const flagsRaw = ok.flags
    const flagsStr =
      typeof flagsRaw === 'object' && typeof flagsRaw?.toString === 'function'
        ? flagsRaw.toString()
        : String(flagsRaw ?? 0)
    if ((BigInt(flagsStr) & 1n) === 1n) throw new Error('Dry-run: contract reverted')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const weightRequired = (dryRun as any).weight_required ?? {
      ref_time: 500_000_000_000n,
      proof_size: 500_000n
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storageDeposit = (dryRun as any).storage_deposit
    const storageDepositLimit = storageDeposit?.type === 'Charge' ? storageDeposit.value : 0n

    const tx = api.tx.Revive.call({
      dest: FixedSizeBinary.fromHex(REGISTRY as `0x${string}`),
      value: 0n,
      weight_limit: weightRequired,
      storage_deposit_limit: storageDepositLimit,
      data: Binary.fromHex(calldata)
    })

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

  async attest(label: string): Promise<{ txHash: string; block: string }> {
    const node = namehash(`${label}.dot`)
    const subject = nodeToSubject(node) as `0x${string}`
    const calldata = encodeAttest(
      subject,
      SCHEMA_FAVOURITE as `0x${string}`,
      `0x${'00'.repeat(32)}` as `0x${string}`,
      0n
    )
    return this.submitTx(calldata)
  }

  async revoke(label: string): Promise<{ txHash: string; block: string }> {
    const node = namehash(`${label}.dot`)
    const subject = nodeToSubject(node) as `0x${string}`
    const calldata = encodeRevoke(subject, SCHEMA_FAVOURITE as `0x${string}`)
    return this.submitTx(calldata)
  }
}

export const attestationRegistry = new AttestationRegistryService()
