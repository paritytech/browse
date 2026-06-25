/**
 * Refresh the identity account personhood alias so the gated resolver admits
 * its attestations.
 *
 * AssetHub keeps only the most-recent K ring-root revisions
 * (`MembersSubscriber.RingRoots`). Once a holder's stored alias revision ages
 * out of that window the personhood precompile reports NoStatus. The
 * `AliasAccounts.AccountToAlias` row still exists, but the resolver
 * `onAttest` hook rejects anyway. Re-proving the alias against the current
 * revision (a free, signed `reprove_alias_account`) brings it back into grace.
 */

import { PASEO_ASSETHUB_NEXT_V2_GENESIS, PREVIEWNET_ASSETHUB_GENESIS } from '@parity/browse-sdk'
import { paseohub, paseopeople, previewnethub, previewnetpeople } from '@polkadot-api/descriptors'
import { Blake2256, compact } from '@polkadot-api/substrate-bindings'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { entropyToMiniSecret, mnemonicToEntropy, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { blake2AsU8a } from '@polkadot/util-crypto'
import { Binary, createClient, type SS58String } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: verifiablejs ships no types for the nodejs subpath
import { member_from_entropy, one_shot } from 'verifiablejs/nodejs'

import { ASSETHUB_GENESIS, NETWORK } from '../../src/lib/config'
import { DEV_PHRASE as IDENTITY_PHRASE } from '../utils'

// The People membership collection id: "pop:polkadot.network/people" then padding.
const PEOPLE_MEMBER_IDENTIFIER_HEX =
  '0x706f703a706f6c6b61646f742e6e6574776f726b2f70656f706c652020202020'
// bytes32("dotns"). Must match the resolver's HUMANITY_CONTEXT.
const DOTNS_CONTEXT_HEX = '0x646f746e73000000000000000000000000000000000000000000000000000000'
const MEMBER_ENTROPY_KEY = new TextEncoder().encode('candidate')
const ALIAS_PROOF_TAG = new TextEncoder().encode('alias-accounts')

// The People RPC lives in the SDK config (NETWORK.PEOPLE_RPCS). Only the
// app-local papi descriptor is keyed here by the active Asset Hub genesis.
const PEOPLE_DESCRIPTOR_BY_ASSETHUB = {
  [PREVIEWNET_ASSETHUB_GENESIS]: previewnetpeople,
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: paseopeople
} as const

const hubDescriptor = ({
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: paseohub,
  [PREVIEWNET_ASSETHUB_GENESIS]: previewnethub
}[ASSETHUB_GENESIS as typeof PREVIEWNET_ASSETHUB_GENESIS] ??
  previewnethub) as typeof previewnethub

const concatBytes = (...arrays: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0))
  let off = 0
  for (const a of arrays) {
    out.set(a, off)
    off += a.length
  }
  return out
}

const u64LeBytes = (value: bigint): Uint8Array => {
  const buf = new Uint8Array(8)
  new DataView(buf.buffer).setBigUint64(0, value, true)
  return buf
}

function wsClient(rpc: string) {
  return createClient(
    getWsProvider(rpc, { websocketClass: WebSocket as unknown as typeof globalThis.WebSocket })
  )
}

export async function reproveIdentityPersonhood(): Promise<void> {
  const peopleRpc = NETWORK.PEOPLE_RPCS?.[0]
  const peopleDescriptor =
    PEOPLE_DESCRIPTOR_BY_ASSETHUB[ASSETHUB_GENESIS as keyof typeof PEOPLE_DESCRIPTOR_BY_ASSETHUB]
  if (!peopleRpc || !peopleDescriptor) {
    throw new Error(`No People chain configured for ${ASSETHUB_GENESIS}`)
  }

  const entropy = mnemonicToEntropy(IDENTITY_PHRASE.trim().split(/\s+/).join(' '))
  const memberEntropy = blake2AsU8a(entropy, 256, MEMBER_ENTROPY_KEY)
  const memberKey = member_from_entropy(memberEntropy) as Uint8Array
  const memberKeyHex = Binary.toHex(memberKey)

  const keypair = sr25519CreateDerive(entropyToMiniSecret(entropy))('//wallet')
  const account = ss58Encode(keypair.publicKey, 42) as SS58String

  const ahClient = wsClient(NETWORK.ASSETHUB_RPCS[0])
  const peopleClient = wsClient(peopleRpc)
  const ahApi = ahClient.getTypedApi(hubDescriptor)
  const peopleApi = peopleClient.getTypedApi(peopleDescriptor)

  try {
    const preBound = await ahApi.query.AliasAccounts.AccountToAlias.getValue(account, {
      at: 'best'
    })
    if (preBound === undefined) {
      throw new Error(`No AliasAccounts row for ${account}. Bind the alias before reproving.`)
    }
    if (preBound.ca.context.toLowerCase() !== DOTNS_CONTEXT_HEX) {
      throw new Error(`Stored alias context ${preBound.ca.context} != dotns; cannot reprove.`)
    }

    const position = await peopleApi.query.Members.Members.getValue(
      PEOPLE_MEMBER_IDENTIFIER_HEX,
      memberKeyHex,
      { at: 'best' }
    )
    if (!position || position.type !== 'Included') {
      throw new Error(`Member key not Included on People (position=${position?.type}).`)
    }
    const ringIndex = position.value.ring_index

    const allEntries = await peopleApi.query.Members.RingKeys.getEntries({ at: 'best' })
    const pages: Array<[number, string[]]> = []
    for (const entry of allEntries) {
      if (String(entry.keyArgs[0]).toLowerCase() !== PEOPLE_MEMBER_IDENTIFIER_HEX) continue
      if (Number(entry.keyArgs[1]) !== ringIndex) continue
      pages.push([Number(entry.keyArgs[2]), entry.value as unknown as string[]])
    }
    pages.sort((a, b) => a[0] - b[0])
    const ringKeys = pages.flatMap(([, ks]) => ks)
    const membersBytes = concatBytes(
      compact.enc(ringKeys.length),
      ...ringKeys.map((hex) => Binary.fromHex(hex))
    )

    const ringExponent = await ahApi.constants.AliasAccounts.PeopleRingExponent()
    const ringExpNum = ringExponent.type === 'R2e9' ? 9 : ringExponent.type === 'R2e10' ? 10 : 14

    const ringRoots = await ahApi.query.MembersSubscriber.RingRoots.getValue(
      preBound.collection,
      ringIndex,
      { at: 'best' }
    )
    if (!ringRoots || ringRoots.length === 0) {
      throw new Error('No RingRoots indexed on AH for this (collection, ring).')
    }
    const revision = ringRoots[ringRoots.length - 1].revision

    // Already on the freshest revision, so the precompile is satisfied. Nothing to do.
    if (revision <= preBound.revision && ringIndex === preBound.ring) return

    const nowMs = await ahApi.query.Timestamp.Now.getValue({ at: 'best' })
    const proofValidAt = nowMs / 1000n
    const proofMsg = Blake2256(
      concatBytes(ALIAS_PROOF_TAG, keypair.publicKey, u64LeBytes(proofValidAt))
    )

    const proofResult = one_shot(
      ringExpNum,
      memberEntropy,
      membersBytes,
      Binary.fromHex(DOTNS_CONTEXT_HEX),
      proofMsg
    ) as { proof: Uint8Array; alias: Uint8Array }

    const regenAlias = Binary.toHex(proofResult.alias).toLowerCase()
    if (regenAlias !== preBound.ca.alias.toLowerCase()) {
      throw new Error(`Regenerated alias ${regenAlias} != stored ${preBound.ca.alias}.`)
    }

    const tx = ahApi.tx.AliasAccounts.reprove_alias_account({
      proof: proofResult.proof,
      ring_index: ringIndex,
      ring_revision: revision,
      proof_valid_at: proofValidAt
    })
    const signer = getPolkadotSigner(keypair.publicKey, 'Sr25519', keypair.sign)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      tx.signSubmitAndWatch(signer).subscribe({
        next: (ev) => {
          if (settled) return
          if ((ev.type === 'txBestBlocksState' && ev.found) || ev.type === 'finalized') {
            settled = true
            if (ev.ok === false) {
              reject(new Error(`reprove failed: ${JSON.stringify(ev.dispatchError)}`))
            } else {
              resolve()
            }
          }
        },
        error: (err) => {
          if (settled) return
          settled = true
          reject(err)
        }
      })
    })
  } finally {
    try {
      ahClient.destroy()
    } catch {
      // ignore teardown errors
    }
    try {
      peopleClient.destroy()
    } catch {
      // ignore teardown errors
    }
  }
}
