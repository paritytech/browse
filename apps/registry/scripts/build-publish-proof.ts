/**
 * Builds the ring-VRF personhood proof `Publisher.publish` needs, and prints it
 * as the environment `evm/scripts/publish.ts` reads.
 *
 * Publisher 3.0.0 has no owner path, so every publish carries a proof that the
 * caller is a person. The contract overwrites the proof `message` with
 * `getPublishDigest(msg.sender, labelhash)` and the `context` with `dotns`
 * before verifying, so both have to be known up front. Pass the digest in.
 * `npm run read:contract` on the Publisher will tell you it.
 *
 * ```sh
 * MSG=0x0487a141… bun scripts/build-publish-proof.ts
 * ```
 *
 * Lives here rather than in `evm/` because the wasm prover and the papi
 * descriptors it reads the ring from are both app dependencies.
 *
 * `docs/publishing-registry.md` explains the two traps this script exists to
 * get right: the SCALE length prefix on `proof`, and the revision window.
 */

import { member_from_entropy, one_shot, validate_with_commitment } from 'verifiablejs/nodejs'
import { previewnethub, previewnetpeople } from '@polkadot-api/descriptors'
import { mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers'
import { Bytes, Vector } from '@polkadot-api/substrate-bindings'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { fullPersonRingVrfEntropy } from '@parity/browse-sdk'

import { NETWORK } from '../src/lib/config'

/** `bytes32("dotns")`, the Publisher `PERSONHOOD_CONTEXT`, right-padded. */
const PERSONHOOD_CONTEXT = new Uint8Array(32)
PERSONHOOD_CONTEXT.set(new TextEncoder().encode('dotns'), 0)

/** The people-collection identifier the personhood precompile binds against. */
const PEOPLE_MEMBER_IDENTIFIER_HEX =
  '0x706f703a706f6c6b61646f742e6e6574776f726b2f70656f706c652020202020'

const MembersCodec = Vector(Bytes(32))

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

function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v
  if (typeof v === 'string') return hexToBytes(v)
  if (v && typeof (v as { asBytes?: unknown }).asBytes === 'function') {
    return (v as { asBytes: () => Uint8Array }).asBytes()
  }
  throw new Error('cannot coerce value to bytes')
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
  return fullPersonRingVrfEntropy(mnemonicToEntropy(normalized), NETWORK.TLD)
}

async function main() {
  const msg = process.env.MSG
  if (!msg?.startsWith('0x')) {
    console.error('Set MSG to the publish digest, from getPublishDigest on the Publisher.')
    process.exit(1)
  }
  const mnemonic = process.env.MNEMONIC
  if (!mnemonic) {
    console.error('Set MNEMONIC. It has to be the same key that signs the publish.')
    process.exit(1)
  }

  const entropy = deriveMemberEntropy(mnemonic)
  const memberKey = member_from_entropy(entropy)

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
    if (!position || position.type !== 'Included') {
      console.error(
        `Member key ${bytesToHex(memberKey)} is not in a ring (${position?.type ?? 'absent'}).` +
          ` Personhood has to be minted for it before it can publish.`
      )
      process.exit(1)
    }
    const ringIndex = position.value.ring_index

    const pages: Array<[number, Uint8Array[]]> = []
    for (const entry of await peopleApi.query.Members.RingKeys.getEntries({ at: 'best' })) {
      if (bytesToHex(toBytes(entry.keyArgs[0])).toLowerCase() !== identHex) continue
      if (Number(entry.keyArgs[1]) !== ringIndex) continue
      pages.push([Number(entry.keyArgs[2]), [...entry.value].map(toBytes)])
    }
    pages.sort((a, b) => a[0] - b[0])
    const membersBytes = MembersCodec.enc(pages.flatMap(([, keys]) => keys))

    const collectionId = await ahApi.constants.AliasAccounts.PeopleCollectionIdentifier()
    const ringExponent = await ahApi.constants.AliasAccounts.PeopleRingExponent()
    const ringExpNum = ringExponent.type === 'R2e9' ? 9 : ringExponent.type === 'R2e10' ? 10 : 14

    type RingRootsKey = Parameters<typeof ahApi.query.MembersSubscriber.RingRoots.getValue>
    const ringRoots = await ahApi.query.MembersSubscriber.RingRoots.getValue(
      0,
      collectionId as RingRootsKey[1],
      ringIndex,
      { at: 'best' }
    )
    if (!ringRoots || ringRoots.length === 0) {
      console.error(`No ring root for ring ${ringIndex} yet. Asset Hub has not synced it.`)
      process.exit(1)
    }
    const latest = ringRoots[ringRoots.length - 1]!

    const message = hexToBytes(msg)
    const proof = one_shot(ringExpNum, entropy, membersBytes, PERSONHOOD_CONTEXT, message)

    // Free pre-flight. A proof built against a revision that has already fallen
    // out of the RingRoots window fails here rather than in the transaction.
    validate_with_commitment(
      ringExpNum,
      proof.proof,
      toBytes(latest.root),
      PERSONHOOD_CONTEXT,
      message
    )

    // The precompile decodes `proof` as SCALE, so the raw bytes need their
    // compact length in front. Without it, verification just returns false.
    const prefixed = new Uint8Array(compactEncode(proof.proof.length).length + proof.proof.length)
    prefixed.set(compactEncode(proof.proof.length), 0)
    prefixed.set(proof.proof, compactEncode(proof.proof.length).length)

    console.log(`PROOF=${bytesToHex(prefixed)}`)
    console.log(`ALIAS=${bytesToHex(toBytes(proof.alias))}`)
    console.log(`RING=${ringIndex}`)
    console.log(`CONTEXT=${bytesToHex(PERSONHOOD_CONTEXT)}`)
    console.log(`REVISION=${latest.revision}`)
    console.log(`MSG=${msg}`)
  } finally {
    peopleClient.destroy()
    ahClient.destroy()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
