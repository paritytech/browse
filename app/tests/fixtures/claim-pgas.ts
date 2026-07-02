/**
 * Self-service PGAS claim for the e2e funder via `Pgas.claim_pgas`.
 */

import { member_from_entropy, one_shot, validate_with_commitment } from 'verifiablejs/nodejs'
import { previewnethub, previewnetpeople } from '@polkadot-api/descriptors'
import { blake2b } from '@noble/hashes/blake2.js'
import { mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers'
import { Blake2256, Bytes, Vector } from '@polkadot-api/substrate-bindings'
import { AccountId, createClient, Enum, type SS58String } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { NETWORK } from '../../src/lib/config'
import { DEV_PHRASE } from '../utils'

const MEMBER_ENTROPY_KEY = new TextEncoder().encode('candidate')
const PGAS_CONTEXT_PREFIX = new TextEncoder().encode('pop:gas:') // 8 bytes
const SECS_PER_DAY = 86_400n
// The people-collection identifier the AsPgas extension binds against.
const PEOPLE_MEMBER_IDENTIFIER_HEX =
  '0x706f703a706f6c6b61646f742e6e6574776f726b2f70656f706c652020202020'

const wsProvider = (url: string) =>
  getWsProvider(url, { websocketClass: WebSocket as unknown as typeof globalThis.WebSocket })

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(b: Uint8Array): `0x${string}` {
  return ('0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

// The browse papi returns binary values as a Uint8Array, a hex string, or a
// `Binary` object depending on the field. Normalise to bytes.
function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v
  if (typeof v === 'string') return hexToBytes(v)
  if (v && typeof (v as { asBytes?: unknown }).asBytes === 'function') {
    return (v as { asBytes: () => Uint8Array }).asBytes()
  }
  throw new Error('cannot coerce value to bytes')
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) {
    out.set(a, off)
    off += a.length
  }
  return out
}

function compactEncode(n: number): Uint8Array {
  if (n < 64) return new Uint8Array([n << 2])
  if (n < 16384) {
    const v = (n << 2) | 0b01
    return new Uint8Array([v & 0xff, (v >> 8) & 0xff])
  }
  if (n < 1073741824) {
    const v = (n << 2) | 0b10
    return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff])
  }
  throw new Error('compactEncode: too large')
}

function deriveMemberEntropy(mnemonic: string): Uint8Array {
  const normalized = mnemonic.trim().split(/\s+/).join(' ')
  const bip39Entropy = mnemonicToEntropy(normalized)
  return blake2b(bip39Entropy, { dkLen: 32, key: MEMBER_ENTROPY_KEY })
}

// [PGAS_CONTEXT_PREFIX (8b) | day u32 LE | slot u32 LE | zeros (16b)]
function buildGasContext(day: number, slotIndex: number): Uint8Array {
  const out = new Uint8Array(32)
  out.set(PGAS_CONTEXT_PREFIX, 0)
  const dv = new DataView(out.buffer)
  dv.setUint32(8, day, true)
  dv.setUint32(12, slotIndex, true)
  return out
}

// The AsPgas inherited implication excludes every extension at or after AsPgas
// in the pipeline, plus AuthorizeCall and StorageWeightReclaim.
function buildImplicationExclude(pipelineOrder: string[]): Set<string> {
  const asPgasIdx = pipelineOrder.indexOf('AsPgas')
  if (asPgasIdx < 0) throw new Error('AsPgas not in the AH extension pipeline')
  return new Set<string>([
    ...pipelineOrder.slice(0, asPgasIdx + 1),
    'AuthorizeCall',
    'StorageWeightReclaim'
  ])
}

interface CapturedExtensions {
  order: string[]
  byIdentifier: Record<string, { value: Uint8Array; additionalSigned: Uint8Array }>
}

async function readExtensionOrder(metadata: Uint8Array): Promise<string[]> {
  const { decAnyMetadata, unifyMetadata } = await import('@polkadot-api/substrate-bindings')
  const meta = unifyMetadata(decAnyMetadata(metadata))
  const raw = meta.extrinsic.signedExtensions as unknown
  if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { 0?: unknown })[0])) {
    return (raw as { 0: Array<{ identifier: string }> })[0].map((x) => x.identifier)
  }
  if (Array.isArray(raw)) return (raw as Array<{ identifier: string }>).map((x) => x.identifier)
  throw new Error('unrecognised signedExtensions shape')
}

// Sign once with a sentinel signer that captures the extension bytes, then
// aborts the papi signing flow before it actually signs.
async function capturePass(
  innerTx: { sign: (signer: unknown, options: unknown) => Promise<string> },
  asPgasValue: unknown
): Promise<CapturedExtensions> {
  let captured: CapturedExtensions | null = null
  const sentinel = new Error('__capture_sentinel__')
  const signer = {
    publicKey: new Uint8Array(32),
    signTx: async (
      _callData: Uint8Array,
      signedExtensions: Record<
        string,
        { identifier: string; value: Uint8Array; additionalSigned: Uint8Array }
      >,
      metadata: Uint8Array
    ) => {
      const order = await readExtensionOrder(metadata)
      const byIdentifier: CapturedExtensions['byIdentifier'] = {}
      for (const id of order) {
        const ext = signedExtensions[id]
        if (!ext) throw new Error(`missing extension '${id}'`)
        byIdentifier[id] = { value: ext.value, additionalSigned: ext.additionalSigned }
      }
      captured = { order, byIdentifier }
      throw sentinel
    },
    signBytes: async () => new Uint8Array(64)
  }
  try {
    await innerTx.sign(signer, {
      mortality: { mortal: false },
      customSignedExtensions: {
        AsPgas: { value: asPgasValue, additionalSigned: new Uint8Array() }
      }
    })
  } catch (e) {
    if (e !== sentinel) throw e
  }
  if (!captured) throw new Error('extension capture failed')
  return captured
}

function buildImplication(callBytes: Uint8Array, ext: CapturedExtensions, exclude: Set<string>) {
  const restExplicit: Uint8Array[] = []
  const restImplicit: Uint8Array[] = []
  for (const id of ext.order) {
    if (exclude.has(id)) continue
    const e = ext.byIdentifier[id]
    restExplicit.push(e.value)
    restImplicit.push(e.additionalSigned)
  }
  return Blake2256(concatBytes(new Uint8Array([0]), callBytes, ...restExplicit, ...restImplicit))
}

function buildV5General(callBytes: Uint8Array, ext: CapturedExtensions): Uint8Array {
  const allExplicit = ext.order.map((id) => ext.byIdentifier[id].value)
  const body = concatBytes(
    new Uint8Array([0x45]),
    new Uint8Array([0x00]),
    ...allExplicit,
    callBytes
  )
  return concatBytes(compactEncode(body.length), body)
}

const MembersCodec = Vector(Bytes(32))

export interface ClaimResult {
  claimed: boolean
  amount: bigint
}

/**
 * Claim `PgasClaimAmount` PGAS to `target` for the given day slot, proving
 * personhood with the identity mnemonic. Returns `{ claimed: false }` when the
 * member is not in a ring or has no ring root yet.
 */
export async function claimPgas(target: string, slotIndex = 0): Promise<ClaimResult> {
  const memberEntropy = deriveMemberEntropy(DEV_PHRASE)
  const memberKey = member_from_entropy(memberEntropy)

  const peopleClient = createClient(wsProvider(NETWORK.PEOPLE_RPCS![0]))
  const ahClient = createClient(wsProvider(NETWORK.ASSETHUB_RPCS[0]))
  const peopleApi = peopleClient.getTypedApi(previewnetpeople)
  const ahApi = ahClient.getTypedApi(previewnethub)

  try {
    const identHex = PEOPLE_MEMBER_IDENTIFIER_HEX.toLowerCase()
    type MembersKey = Parameters<typeof peopleApi.query.Members.Members.getValue>
    const position = await peopleApi.query.Members.Members.getValue(
      PEOPLE_MEMBER_IDENTIFIER_HEX as MembersKey[0],
      bytesToHex(memberKey) as MembersKey[1],
      { at: 'best' }
    )
    if (!position || position.type !== 'Included') return { claimed: false, amount: 0n }
    const ringIndex = position.value.ring_index

    const allEntries = await peopleApi.query.Members.RingKeys.getEntries({ at: 'best' })
    const pages: Array<[number, Uint8Array[]]> = []
    for (const entry of allEntries) {
      if (bytesToHex(toBytes(entry.keyArgs[0])).toLowerCase() !== identHex) continue
      if (Number(entry.keyArgs[1]) !== ringIndex) continue
      pages.push([Number(entry.keyArgs[2]), [...entry.value].map(toBytes)])
    }
    pages.sort((a, b) => a[0] - b[0])
    const ringKeys = pages.flatMap(([, ks]) => ks)
    const membersBytes = MembersCodec.enc(ringKeys)

    const collectionId = await ahApi.constants.AliasAccounts.PeopleCollectionIdentifier()
    const ringExponent = await ahApi.constants.AliasAccounts.PeopleRingExponent()
    const ringExpNum = ringExponent.type === 'R2e9' ? 9 : ringExponent.type === 'R2e10' ? 10 : 14

    const ringRoots = await ahApi.query.MembersSubscriber.RingRoots.getValue(
      collectionId,
      ringIndex,
      { at: 'best' }
    )
    if (!ringRoots || ringRoots.length === 0) return { claimed: false, amount: 0n }
    const latest = ringRoots[ringRoots.length - 1]
    const revision = latest.revision

    const nowRaw = await ahApi.query.Timestamp.Now.getValue({ at: 'best' })
    const nowSec = nowRaw > 10_000_000_000n ? nowRaw / 1000n : nowRaw
    const day = Number(nowSec / SECS_PER_DAY)
    const contextBytes = buildGasContext(day, slotIndex)

    const inner = ahApi.tx.Pgas.claim_pgas({ slot_index: slotIndex, target: target as SS58String })
    const callBytes = toBytes(await inner.getEncodedData())

    const signable = inner as unknown as {
      sign: (signer: unknown, options: unknown) => Promise<string>
    }
    const passEmpty = await capturePass(signable, undefined)
    const exclude = buildImplicationExclude(passEmpty.order)
    const msg = buildImplication(callBytes, passEmpty, exclude)

    const proofResult = one_shot(ringExpNum, memberEntropy, membersBytes, contextBytes, msg)

    // Pre-flight: fail before submitting if the proof does not match the AH ring root.
    validate_with_commitment(ringExpNum, proofResult.proof, toBytes(latest.root), contextBytes, msg)

    const asPgasValue = Enum('Claim', {
      proof: proofResult.proof,
      ring_index: ringIndex,
      revision,
      collection: Enum('People'),
      day
    })
    const passProof = await capturePass(signable, asPgasValue)
    const extrinsicBytes = buildV5General(callBytes, passProof)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      ahClient.submitAndWatch(extrinsicBytes).subscribe({
        next: (ev) => {
          if (settled) return
          if ((ev.type === 'txBestBlocksState' && ev.found) || ev.type === 'finalized') {
            settled = true
            if (ev.ok === false)
              reject(new Error(`claim_pgas failed: ${JSON.stringify(ev.dispatchError)}`))
            else resolve()
          }
        },
        error: (err) => {
          if (!settled) reject(err)
          settled = true
        }
      })
    })

    const amount = await ahApi.constants.Pgas.PgasClaimAmount()
    return { claimed: true, amount }
  } finally {
    peopleClient.destroy()
    ahClient.destroy()
  }
}

/** Normalise a public key to an SS58 address. */
export const toSs58 = (publicKey: Uint8Array): string => AccountId(42, 32).dec(publicKey)
