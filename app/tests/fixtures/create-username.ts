/**
 * Registers the username the per-run identity reveals on a first recommendation.
 *
 * The identity registers itself as a lite person with
 * `PeopleLite.register_with_fee` and carries a consumer registration, which the
 * pallet verifies against the candidate itself and turns into the
 * `Resources.UsernameOwnerOf` entry the app resolves. One fee, no sudo, no
 * proxy. The fee is paid on the People chain from the master wallet.
 *
 * Idempotent: an identity that already owns its username is left alone.
 */
import { previewnetpeople } from '@polkadot-api/descriptors'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, mnemonicToEntropy, mnemonicToMiniSecret } from '@polkadot-labs/hdkd-helpers'
import { Binary, createClient, Enum, type SS58String, type TypedApi } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'
import { member_from_entropy, sign, verify_signature } from 'verifiablejs/nodejs'
import { bytesToHex } from 'viem'
import { deriveRingVrfEntropy } from '@parity/browse-sdk'
import { NETWORK } from '../../src/lib/config'
import { identityPath, identityUsername } from '../utils'
import { createMasterSigner, createProductSigner } from './fund'

// The app resolves usernames from this People chain.
const PEOPLE_RPC = NETWORK.PEOPLE_RPCS![0]

// A plain People-chain call must set its VerifyMultiSignature extension to Disabled.
const SIGN_OPTIONS = {
  customSignedExtensions: { VerifyMultiSignature: { value: Enum('Disabled') } }
}

/** `PeopleLite.register_with_fee` verifies a plain VRF signature over this. */
const REGISTER_MSG_PREFIX = new TextEncoder().encode('pop:people-lite:register using')

/** The registration fee (75) plus the existential deposit and transaction fees. */
const REGISTRATION_NEED = 80n * 10n ** 10n

/** `CommunicationIdentifier = [u8; 65]`: a keypair-type byte, a key, padding. */
const IDENTIFIER_KEY_BYTES = 65

type PeopleApi = TypedApi<typeof previewnetpeople>

async function withPeopleApi<T>(fn: (api: PeopleApi) => Promise<T>): Promise<T> {
  const client = createClient(
    getWsProvider(PEOPLE_RPC, {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )
  try {
    return await fn(client.getTypedApi(previewnetpeople))
  } finally {
    try {
      client.destroy()
    } finally {
      // ignore teardown errors
    }
  }
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0))
  let off = 0
  for (const a of arrays) {
    out.set(a, off)
    off += a.length
  }
  return out
}

/** SCALE compact length prefix, for lengths under 2^14. */
function compactLength(length: number): Uint8Array {
  if (length < 1 << 6) return Uint8Array.of(length << 2)
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, (length << 2) | 0b01, true)
  return out
}

/**
 * The bytes the candidate signs to consent to its consumer registration:
 * `account ‖ verifier ‖ identifier_key ‖ Vec<u8>(base) ‖ Option(reserved)`,
 * SCALE encoded, where the base is the username before its `.` and the
 * verifier is the candidate itself on the fee path.
 */
function consumerRegistrationMessage(
  account: Uint8Array,
  identifierKey: Uint8Array,
  usernameBase: string
): Uint8Array {
  const base = new TextEncoder().encode(usernameBase)
  return concatBytes(
    account,
    account,
    identifierKey,
    compactLength(base.length),
    base,
    Uint8Array.of(0)
  )
}

/** The identity's key in the 65-byte on-chain container the chat feature reads. */
function identifierKeyOf(publicKey: Uint8Array): Uint8Array {
  const out = new Uint8Array(IDENTIFIER_KEY_BYTES)
  out.set(publicKey, 1)
  return out
}

/** The per-run identity's own lite ring-VRF key, unique to its wallet path. */
function identityRingEntropy(): Uint8Array {
  return deriveRingVrfEntropy(mnemonicToEntropy(DEV_PHRASE), `e2e-identity:${identityPath()}`, 0)
}

/**
 * Give the identity its username, once per run via globalSetup. Registers it as
 * a lite person with the username in the same extrinsic when it has none yet.
 */
export async function createUsername(): Promise<void> {
  const identity = createProductSigner()
  const username = identityUsername()
  const [base] = username.split('.')
  await withPeopleApi(async (api) => {
    const owner = await api.query.Resources.UsernameOwnerOf.getValue(Binary.fromText(username), {
      at: 'best'
    })
    if (owner === identity.address) return
    if (owner !== undefined) {
      throw new Error(`username ${username} is owned by ${owner}, not by this run's identity`)
    }
    const registered = await api.query.PeopleLite.LitePeople.getValue(
      identity.address as SS58String,
      { at: 'best' }
    )
    if (registered) {
      throw new Error(
        `identity ${identity.address} is already a lite person without ${username}; a username can only be registered with the person`
      )
    }

    // The fee is paid on People; the master wallet holds native there.
    const free = (
      await api.query.System.Account.getValue(identity.address as SS58String, { at: 'best' })
    ).data.free
    if (free < REGISTRATION_NEED) {
      const master = createMasterSigner()
      const topUp = await api.tx.Balances.transfer_keep_alive({
        dest: { type: 'Id', value: identity.address as SS58String },
        value: REGISTRATION_NEED - free
      }).signAndSubmit(master.signer, SIGN_OPTIONS)
      if (!topUp.ok)
        throw new Error(
          `funding the identity on People failed: ${JSON.stringify(topUp.dispatchError)}`
        )
    }

    const entropy = identityRingEntropy()
    const memberKey = member_from_entropy(entropy)
    const proof = sign(entropy, concatBytes(REGISTER_MSG_PREFIX, identity.publicKey, memberKey))
    if (
      !verify_signature(
        proof,
        concatBytes(REGISTER_MSG_PREFIX, identity.publicKey, memberKey),
        memberKey
      )
    ) {
      throw new Error('proof of ownership does not verify locally')
    }
    const identifierKey = identifierKeyOf(identity.publicKey)
    // Raw sr25519 over the payload, as the pallet verifies it; a papi signer
    // would wrap the bytes.
    const wallet = sr25519CreateDerive(mnemonicToMiniSecret(DEV_PHRASE, ''))(identityPath())
    const consent = wallet.sign(
      consumerRegistrationMessage(identity.publicKey, identifierKey, base!)
    )

    type Args = Parameters<typeof api.tx.PeopleLite.register_with_fee>[0]
    const result = await api.tx.PeopleLite.register_with_fee({
      ring_vrf_key: bytesToHex(memberKey),
      proof_of_ownership: bytesToHex(proof),
      consumer_registration: {
        signature: Enum('Sr25519', bytesToHex(consent)),
        account: identity.address as SS58String,
        identifier_key: bytesToHex(identifierKey),
        username: Binary.fromText(username),
        reserved_username: undefined
      }
    } as Args).signAndSubmit(identity.signer, SIGN_OPTIONS)
    if (!result.ok) {
      throw new Error(
        `register_with_fee for ${username} failed: ${JSON.stringify(result.dispatchError)}`
      )
    }
    console.log(
      `[create-username] ${identity.address} registered as a lite person owning ${username}`
    )
  })
}
