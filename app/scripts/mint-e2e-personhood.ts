/**
 * Recognizes personhood for the e2e funder ring-VRF key on the People chain.
 *
 * The suite tops its own PGAS up by claiming from the personhood faucet, which
 * only answers a key that is a member of a ring. A network reset wipes the
 * members map, so until this runs the whole suite dies in `globalSetup` with
 * `PGAS funder holds 0`.
 *
 * Goes through `DummyDim`, the testnet stand-in for a real personhood oracle,
 * dispatched as sudo. Ring inclusion and the Asset Hub `RingRoots` sync follow
 * on their own within a few minutes, after which the claim starts working.
 *
 * ```sh
 * bun scripts/mint-e2e-personhood.ts
 * ```
 *
 * Idempotent. It reports and exits when the key is already a member.
 */

import { member_from_entropy } from 'verifiablejs/nodejs'
import { mnemonicToEntropy, sr25519 } from '@polkadot-labs/hdkd-helpers'
import { createClient, Enum, type PolkadotSigner } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'
import { hexToBytes } from 'viem'

import { fullPersonRingVrfEntropy } from '@parity/browse-sdk'

import { NETWORK } from '../src/lib/config'
import { DEV_PHRASE as IDENTITY_PHRASE } from '../tests/utils'

/** The people-collection identifier the members map is keyed under. */
const PEOPLE_MEMBER_IDENTIFIER_HEX =
  '0x706f703a706f6c6b61646f742e6e6574776f726b2f70656f706c652020202020'

// A plain People-chain call must set its VerifyMultiSignature extension to Disabled.
const SIGN_OPTIONS = {
  customSignedExtensions: { VerifyMultiSignature: { value: Enum('Disabled') } }
}

function bytesToHex(b: Uint8Array): `0x${string}` {
  return ('0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

/**
 * The previewnet sudo key, which is the same account on Asset Hub and People.
 *
 * It is a 64 byte expanded sr25519 secret rather than a seed or a mnemonic, so
 * it signs through `sr25519.sign` directly and cannot be derived from.
 */
function sudoSigner(): PolkadotSigner {
  const hex = process.env.SUDO_PRIVATE_KEY_PREVIEWNET?.trim()
  if (!hex) throw new Error('Set SUDO_PRIVATE_KEY_PREVIEWNET, the expanded sr25519 sudo secret.')
  const secret = hexToBytes(hex.startsWith('0x') ? (hex as `0x${string}`) : `0x${hex}`)
  const publicKey = sr25519.getPublicKey(secret)
  return getPolkadotSigner(publicKey, 'Sr25519', (message) => sr25519.sign(message, secret))
}

/** The funder ring-VRF member key, the same derivation `claim-pgas.ts` proves with. */
function funderMemberKey(): Uint8Array {
  const normalized = IDENTITY_PHRASE.trim().split(/\s+/).join(' ')
  return member_from_entropy(fullPersonRingVrfEntropy(mnemonicToEntropy(normalized), NETWORK.TLD))
}

async function main() {
  const memberKey = funderMemberKey()
  const memberKeyHex = bytesToHex(memberKey)
  console.log(`Member key: ${memberKeyHex}`)

  const signer = sudoSigner()
  const client = createClient(
    getWsProvider(NETWORK.PEOPLE_RPCS![0], {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )
  const api = client.getUnsafeApi()

  try {
    const membership = async () =>
      (await api.query.Members.Members.getValue(PEOPLE_MEMBER_IDENTIFIER_HEX, memberKeyHex, {
        at: 'best'
      })) as { type: string } | undefined

    const existing = await membership()
    if (existing) {
      console.log(`Already a member (${existing.type}), nothing to do.`)
      return
    }

    const asSudo = async (call: unknown, label: string) => {
      const result = await api.tx.Sudo.sudo({ call }).signAndSubmit(signer, SIGN_OPTIONS)
      if (!result.ok) throw new Error(`${label} failed: ${JSON.stringify(result.dispatchError)}`)
      console.log(`  ${label}`)
    }

    const reservedIds = async (): Promise<Set<string>> =>
      new Set(
        (await api.query.DummyDim.ReservedIds.getEntries({ at: 'best' })).map(
          (entry: { keyArgs: unknown[] }) => String(entry.keyArgs[0])
        )
      )

    // Reserve a fresh id rather than reusing one already sitting in ReservedIds.
    // Those belong to whoever reserved them, and recognizing against one loses
    // the race the moment its owner claims it, silently undoing this whole run.
    const before = await reservedIds()
    await asSudo(api.tx.DummyDim.reserve_ids({ count: 1 }).decodedCall, 'reserve_ids')
    const mine = [...(await reservedIds())].filter((id) => !before.has(id))
    const personalId = mine[0] === undefined ? undefined : BigInt(mine[0])
    if (personalId === undefined) {
      console.error('reserve_ids added no new reservation, so there is no id to recognize against.')
      process.exit(1)
    }
    console.log(`Reserved personal id ${personalId}`)

    // No mutation session. `start_mutation_session` puts the whole collection
    // into `RingsState::Mutating`, which stops onboarding for every member of
    // it, and the counter only unwinds one `end_mutation_session` at a time. A
    // run that dies between the two strands the collection for everyone.
    //
    // The member key goes in as a hex string and the id as a bigint. A Binary
    // or a Uint8Array fails the compatibility check for this fixed-size field.
    await asSudo(
      api.tx.DummyDim.recognize_personhood({
        ids_and_keys: [[personalId, memberKeyHex]]
      }).decodedCall,
      'recognize_personhood'
    )

    const now = await membership()
    console.log(`\nMembership: ${now ? now.type : 'still absent'}`)
    console.log('Ring inclusion and the Asset Hub RingRoots sync follow within a few minutes.')
  } finally {
    client.destroy()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
