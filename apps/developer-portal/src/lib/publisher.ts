import { requestPermission, requestResourceAllocation } from '@parity/product-sdk/host'
import { Binary, type PolkadotSigner, type SS58String } from 'polkadot-api'
import {
  concat,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  namehash,
  parseAbi,
  toBytes
} from 'viem'

import { type Identity } from './account'
import { dryRunCall, ensureBrowseSdk, ensureClient, reviveRead } from './chain'
import {
  ACTIVE_PUBLISHER,
  CALL_WEIGHT,
  PGAS_FUNDING_TIMEOUT,
  PUBLISHER_READ_ADDRESSES,
  REGISTRAR,
  STORAGE_DEPOSIT_LIMIT
} from './config'

const PUBLISHER_ABI = parseAbi([
  'function publish(string label)',
  'function unpublish(string label)',
  'function isPublished(bytes32 labelhash) view returns (bool)',
  'function publicationOf(bytes32 labelhash) view returns ((address publisher, uint64 timestamp, uint32 indexPlusOne) publication)',
  'error EmptyLabel()',
  'error NoPersonhood()',
  'error NotOwner(address caller, uint256 tokenId)',
  'error RateLimitExceeded(uint64 nextAvailableAt)'
])

const REGISTRAR_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function labelOf(uint256 tokenId) view returns (string)'
])

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// The precomputed namehash of the `.dot` TLD, matching Publisher.DOT_NODE.
const DOT_NODE = namehash('dot')

const MAX_SCANNED_PUBLICATIONS = 500

export type Publication = { label: string; labelhash: `0x${string}`; timestamp: number }
export type TxResult = { txHash: string; block: string }
export type Verb = 'publish' | 'unpublish'

/** Strip any `.dot` suffix and lowercase, matching how DotNS normalizes labels. */
export function normalizeLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
}

/** The registry key for a bare label: keccak256 of the UTF-8 label. */
function labelhashOf(label: string): `0x${string}` {
  return keccak256(toBytes(label))
}

/** The dotNS tokenId for a label: uint256(keccak256(DOT_NODE ++ labelhash)). */
function tokenIdOf(label: string): bigint {
  return BigInt(keccak256(concat([DOT_NODE, labelhashOf(label)])))
}

/**
 * Turn a reverted publish/unpublish dry-run into an actionable message.
 *
 * Decodes the Publisher custom errors so the user sees why the call would fail
 * before signing, including when a rate-limited slot frees up.
 */
function describeRevert(data: `0x${string}`, label: string): string {
  try {
    const decoded = decodeErrorResult({ abi: PUBLISHER_ABI, data }) as {
      errorName: string
      args?: readonly unknown[]
    }
    switch (decoded.errorName) {
      case 'EmptyLabel':
        return 'Enter a domain label.'
      case 'NotOwner':
        return `This account does not own ${label}.dot.`
      case 'NoPersonhood':
        return 'This account is not verified for personhood, which publishing requires.'
      case 'RateLimitExceeded': {
        const nextAt = Number(decoded.args?.[0] ?? 0n)
        const when = nextAt ? new Date(nextAt * 1000).toLocaleString() : 'later'
        return `Daily publish limit reached. Try again after ${when}.`
      }
      default:
        return `Publishing ${label}.dot would fail (${decoded.errorName}).`
    }
  } catch {
    return `Publishing ${label}.dot would revert on chain.`
  }
}

/** The EVM address that currently owns a label, or the zero address if unminted. */
export async function ownerOf(label: string): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: REGISTRAR_ABI,
    functionName: 'ownerOf',
    args: [tokenIdOf(label)]
  })
  try {
    const raw = await reviveRead(REGISTRAR, data)
    return decodeFunctionResult({
      abi: REGISTRAR_ABI,
      functionName: 'ownerOf',
      data: raw
    }).toLowerCase() as `0x${string}`
  } catch {
    return ZERO_ADDRESS
  }
}

async function labelOf(labelhash: `0x${string}`): Promise<string | null> {
  const data = encodeFunctionData({
    abi: REGISTRAR_ABI,
    functionName: 'labelOf',
    args: [BigInt(keccak256(concat([DOT_NODE, labelhash])))]
  })
  try {
    const raw = await reviveRead(REGISTRAR, data)
    return decodeFunctionResult({ abi: REGISTRAR_ABI, functionName: 'labelOf', data: raw }) || null
  } catch {
    return null
  }
}

/** Whether a label is currently live, checked across every Publisher deployment. */
export async function isPublished(label: string): Promise<boolean> {
  const data = encodeFunctionData({
    abi: PUBLISHER_ABI,
    functionName: 'isPublished',
    args: [labelhashOf(label)]
  })
  const results = await Promise.all(
    PUBLISHER_READ_ADDRESSES.map(async (address) => {
      try {
        const raw = await reviveRead(address, data)
        return decodeFunctionResult({ abi: PUBLISHER_ABI, functionName: 'isPublished', data: raw })
      } catch {
        return false
      }
    })
  )
  return results.some(Boolean)
}

// Throws on a failed read, so callers can tell a network failure apart from
// a label that simply has no live publication.
async function publicationOn(
  publisher: `0x${string}`,
  labelhash: `0x${string}`
): Promise<{ publisher: `0x${string}`; timestamp: number; indexPlusOne: number }> {
  const data = encodeFunctionData({
    abi: PUBLISHER_ABI,
    functionName: 'publicationOf',
    args: [labelhash]
  })
  const raw = await reviveRead(publisher, data)
  const pub = decodeFunctionResult({
    abi: PUBLISHER_ABI,
    functionName: 'publicationOf',
    data: raw
  })
  return {
    publisher: pub.publisher.toLowerCase() as `0x${string}`,
    timestamp: Number(pub.timestamp),
    indexPlusOne: pub.indexPlusOne
  }
}

export interface PublicationStatus {
  published: boolean
  publisher: `0x${string}` | null
  timestamp: number | null
}

/**
 * The live publication record of a label, checked across every Publisher
 * deployment, newest first.
 *
 * A label unpublished everywhere returns `published: false` with no publisher
 * or timestamp, since unpublish deletes the record.
 */
export async function publicationStatus(label: string): Promise<PublicationStatus> {
  const labelhash = labelhashOf(normalizeLabel(label))
  for (const address of PUBLISHER_READ_ADDRESSES) {
    const pub = await publicationOn(address, labelhash)
    if (pub.indexPlusOne !== 0) {
      return { published: true, publisher: pub.publisher, timestamp: pub.timestamp }
    }
  }
  return { published: false, publisher: null, timestamp: null }
}

/**
 * The domains the connected account has published to the active registry.
 *
 * Scans the live published set and keeps the labels whose publication was
 * recorded by this account. Reads the active Publisher only, so a label
 * published solely to a superseded deployment is not listed. Bounded to
 * {@link MAX_SCANNED_PUBLICATIONS} entries.
 */
export async function listMyPublished(h160: `0x${string}`): Promise<Publication[]> {
  const sdk = await ensureBrowseSdk()
  const labelhashes = (await sdk.listPublishedLabelhashes()).slice(0, MAX_SCANNED_PUBLICATIONS)
  const mine = (
    await Promise.all(
      labelhashes.map(async (labelhash) => {
        const pub = await publicationOn(ACTIVE_PUBLISHER, labelhash).catch(() => null)
        return pub && pub.indexPlusOne !== 0 && pub.publisher === h160.toLowerCase()
          ? { labelhash, timestamp: pub.timestamp }
          : null
      })
    )
  ).filter((entry): entry is { labelhash: `0x${string}`; timestamp: number } => entry !== null)

  const labels = await Promise.all(mine.map((entry) => labelOf(entry.labelhash)))
  return mine
    .map((entry, i) => ({ ...entry, label: labels[i] }))
    .filter((p): p is Publication => p.label !== null)
}

/**
 * Best-effort provision of PGAS so the signing account can pay the write.
 *
 * Requests a SmartContractAllowance only when the balance is zero, then waits
 * for the claim to fund. Never throws: an account that pays natively, or a host
 * without the PGAS route, falls through and lets the submit surface any real
 * payment error.
 */
async function ensureAllowance(origin: SS58String): Promise<void> {
  const unsafeApi = (await ensureClient()).getUnsafeApi()
  const balanceOf = async (): Promise<bigint> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = unsafeApi as any
      const pgasAssetId = (await api.constants.Pgas.PgasAssetId()) as number
      const account = await api.query.Assets.Account.getValue(pgasAssetId, origin, { at: 'best' })
      return (account?.balance as bigint | undefined) ?? 0n
    } catch {
      return 0n
    }
  }

  if ((await balanceOf()) > 0n) return

  const resources = [{ tag: 'SmartContractAllowance' as const, value: 0 }]
  const allocation = await requestResourceAllocation(resources)
  const outcomes = allocation.ok ? allocation.value : []
  if (outcomes[0] !== 'Allocated') return

  const deadline = Date.now() + PGAS_FUNDING_TIMEOUT
  while (Date.now() < deadline) {
    if ((await balanceOf()) > 0n) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

const SUBMIT_TIMEOUT_MS = 120_000

type TxEvent = {
  type: string
  found?: boolean
  ok?: boolean
  txHash?: string
  block?: { hash?: string }
  dispatchError?: unknown
}

type WatchableTx = {
  signSubmitAndWatch: (signer: PolkadotSigner) => {
    subscribe: (observer: { next: (event: TxEvent) => void; error: (err: Error) => void }) => {
      unsubscribe: () => void
    }
  }
}

function submit(tx: WatchableTx, signer: PolkadotSigner): Promise<TxResult> {
  return new Promise<TxResult>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sub.unsubscribe()
      fn()
    }
    const timer = setTimeout(
      () => finish(() => reject(new Error('Timed out waiting for the transaction to settle.'))),
      SUBMIT_TIMEOUT_MS
    )
    const sub = tx.signSubmitAndWatch(signer).subscribe({
      next: (event: TxEvent) => {
        if (event.type === 'invalid' || event.type === 'dropped') {
          finish(() => reject(new Error(`Transaction ${event.type}.`)))
          return
        }
        const included =
          event.type === 'finalized' || (event.type === 'txBestBlocksState' && event.found)
        if (!included) return
        if (event.ok === false) {
          finish(() =>
            reject(
              new Error(
                `Transaction reverted on chain: ${JSON.stringify(event.dispatchError ?? {})}`
              )
            )
          )
          return
        }
        finish(() => resolve({ txHash: event.txHash ?? '', block: event.block?.hash ?? '' }))
      },
      error: (err: Error) => finish(() => reject(err))
    })
  })
}

/**
 * Dry-run a contract write, then sign and submit it.
 *
 * The shared write pipeline: the dry run turns a revert into a thrown message
 * before anything is signed, the allowance covers PGAS, and the host grants
 * submit permission. `decodeRevert` maps raw revert data to the message.
 */
export async function submitReviveCall(
  target: `0x${string}`,
  data: `0x${string}`,
  identity: Identity,
  decodeRevert: (data: `0x${string}`) => string
): Promise<TxResult> {
  const dry = await dryRunCall(target, data, identity.ss58)
  if (dry.reverted) throw new Error(decodeRevert(dry.data))

  await ensureAllowance(identity.ss58)

  const permission = await requestPermission({ tag: 'ChainSubmit', value: undefined })
  const permitted = permission.ok ? permission.value : false
  if (!permitted) throw new Error('Transaction submit permission denied.')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (await ensureClient()).getUnsafeApi() as any
  const tx = api.tx.Revive.call({
    dest: Binary.fromHex(target),
    value: 0n,
    weight_limit: CALL_WEIGHT,
    storage_deposit_limit: STORAGE_DEPOSIT_LIMIT,
    data: Binary.fromHex(data)
  })
  return submit(tx, identity.signer)
}

/**
 * Publish or unpublish a label, signed by the connected root account.
 *
 * Dry-runs first so a contract revert (ownership, personhood, rate limit) is
 * decoded into a message before the user signs. `unpublish` skips the personhood
 * and rate-limit gates on chain but still requires ownership.
 */
export async function submitPublish(
  verb: Verb,
  label: string,
  identity: Identity
): Promise<TxResult> {
  const clean = normalizeLabel(label)
  if (!clean) throw new Error('Enter a domain label.')

  const data = encodeFunctionData({ abi: PUBLISHER_ABI, functionName: verb, args: [clean] })
  return submitReviveCall(ACTIVE_PUBLISHER, data, identity, (revert) =>
    describeRevert(revert, clean)
  )
}
