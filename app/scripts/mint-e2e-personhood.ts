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
import { blake2b } from '@noble/hashes/blake2.js'
import { mnemonicToEntropy, sr25519 } from '@polkadot-labs/hdkd-helpers'
import { createClient, Enum, type PolkadotSigner } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'
import { hexToBytes } from 'viem'

import { NETWORK } from '../src/lib/config'
import { DEV_PHRASE as IDENTITY_PHRASE } from '../tests/utils'

const MEMBER_ENTROPY_KEY = new TextEncoder().encode('candidate')

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
  const entropy = blake2b(mnemonicToEntropy(IDENTITY_PHRASE.trim()), {
    dkLen: 32,
    key: MEMBER_ENTROPY_KEY
  })
  return member_from_entropy(entropy)
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

    const reserved = await api.query.DummyDim.ReservedIds.getEntries({ at: 'best' })
    const personalId = reserved
      .map((entry: { keyArgs: unknown[] }) => entry.keyArgs[0] as bigint)
      .sort((a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0))[0]
    if (personalId === undefined) {
      console.error('No reserved personal id available. Run DummyDim.reserve_ids as sudo first.')
      process.exit(1)
    }
    console.log(`Using reserved personal id ${personalId}`)

    const asSudo = async (call: unknown, label: string) => {
      const result = await api.tx.Sudo.sudo({ call }).signAndSubmit(signer, SIGN_OPTIONS)
      if (!result.ok) throw new Error(`${label} failed: ${JSON.stringify(result.dispatchError)}`)
      console.log(`  ${label}`)
    }

    await asSudo(api.tx.DummyDim.start_mutation_session().decodedCall, 'start_mutation_session')
    // The member key goes in as a hex string and the id as a bigint. A Binary or
    // a Uint8Array fails the compatibility check for this fixed-size field.
    await asSudo(
      api.tx.DummyDim.recognize_personhood({
        ids_and_keys: [[personalId, memberKeyHex]]
      }).decodedCall,
      'recognize_personhood'
    )
    await asSudo(api.tx.DummyDim.end_mutation_session().decodedCall, 'end_mutation_session')

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
