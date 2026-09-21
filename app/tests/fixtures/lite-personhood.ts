/**
 * Self-service lite personhood for the e2e funder.
 *
 * The funder claims its PGAS from the personhood faucet, which only answers a
 * ring member. Instead of a sudo-minted full person, the funder registers
 * itself as a lite person with `PeopleLite.register_with_fee` (75 PAS,
 * non-refundable), paid from its own People chain balance. Lite onboarding is
 * cohort-gated: the offchain worker builds a ring once three keys are queued,
 * so when the queue is short the funder also registers throwaway filler keys.
 *
 * Idempotent: a funder already covered by a built ring returns at once.
 */
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { mnemonicToEntropy, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { previewnethub, previewnetpeople } from '@polkadot-api/descriptors'
import { createClient, Enum, type PolkadotSigner, type SS58String } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'
import { member_from_entropy, sign, verify_signature } from 'verifiablejs/nodejs'
import { deriveRingVrfEntropy, lightPersonRingVrfEntropy } from '@parity/browse-sdk'
import { NETWORK } from '../../src/lib/config'
import { DEV_PHRASE as IDENTITY_PHRASE } from '../utils'

/** The members collection lite people are onboarded into, as `Members.Members` keys it. */
export const LITE_COLLECTION_HEX = bytesToHex(
  new TextEncoder().encode('pop:polkadot.network/people-lite')
)

/** `PeopleLite.register_with_fee` verifies a plain VRF signature over this. */
const REGISTER_MSG_PREFIX = new TextEncoder().encode('pop:people-lite:register using')

/** The runtime default while `PeopleLite.RegistrationFee` is unset. */
const REGISTRATION_FEE = 75n * 10n ** 10n
/** Fee plus existential deposit and room for the transaction fees. */
const FILLER_NEED = REGISTRATION_FEE + 15n * 10n ** 9n
const COHORT_SIZE = 3

const RING_POLL_MS = 15_000
const RING_WAIT_MS = 15 * 60_000

// A plain People-chain call must set its VerifyMultiSignature extension to Disabled.
const SIGN_OPTIONS = {
  customSignedExtensions: { VerifyMultiSignature: { value: Enum('Disabled') } }
}

type Hex = `0x${string}`

function bytesToHex(b: Uint8Array): Hex {
  return ('0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')) as Hex
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

const normalizedPhrase = () => IDENTITY_PHRASE.trim().split(/\s+/).join(' ')

/** The funder's lite ring-VRF entropy, `//peopl.<tld>` at index 1, as the app derives it. */
export function liteMemberEntropy(): Uint8Array {
  return lightPersonRingVrfEntropy(mnemonicToEntropy(normalizedPhrase()), NETWORK.TLD)
}

/** Filler `i` proves a key of its own, in a domain no real identity uses. */
function fillerEntropy(i: number): Uint8Array {
  return deriveRingVrfEntropy(mnemonicToEntropy(normalizedPhrase()), 'e2e-lite-filler', 1000 + i)
}

interface Account {
  address: SS58String
  publicKey: Uint8Array
  signer: PolkadotSigner
}

function accountAt(path: string): Account {
  const wallet = sr25519CreateDerive(mnemonicToMiniSecret(normalizedPhrase(), ''))(path)
  return {
    address: ss58Encode(wallet.publicKey, 42) as SS58String,
    publicKey: wallet.publicKey,
    signer: getPolkadotSigner(wallet.publicKey, 'Sr25519', async (msg) => wallet.sign(msg))
  }
}

/** The funder, the same `//wallet` account `createMasterSigner` signs with. */
const master = () => accountAt('//wallet')
const filler = (i: number) => accountAt(`//wallet//filler//${i}`)

const wsProvider = (url: string) =>
  getWsProvider(url, { websocketClass: WebSocket as unknown as typeof globalThis.WebSocket })

type PeopleApi = ReturnType<typeof clients>['people']
/** The 32-byte collection identifier as the People chain types it. */
type CollectionId = Parameters<PeopleApi['query']['Members']['Members']['getValue']>[0]

function clients() {
  const peopleClient = createClient(wsProvider(NETWORK.PEOPLE_RPCS![0]))
  const ahClient = createClient(wsProvider(NETWORK.ASSETHUB_RPCS[0]))
  return {
    people: peopleClient.getTypedApi(previewnetpeople),
    ah: ahClient.getTypedApi(previewnethub),
    dispose: () => {
      peopleClient.destroy()
      ahClient.destroy()
    }
  }
}

async function submit(
  label: string,
  tx: {
    signAndSubmit: (
      signer: PolkadotSigner,
      options?: never
    ) => Promise<{ ok: boolean; dispatchError?: unknown }>
  },
  signer: PolkadotSigner
): Promise<void> {
  const result = await tx.signAndSubmit(signer, SIGN_OPTIONS as never)
  if (!result.ok) {
    throw new Error(`${label} failed: ${JSON.stringify(result.dispatchError)}`)
  }
}

/** Where the key stands in the lite collection, or undefined when the chain does not know it. */
async function position(api: PeopleApi, memberKey: Uint8Array) {
  type Key = Parameters<typeof api.query.Members.Members.getValue>
  return api.query.Members.Members.getValue(
    LITE_COLLECTION_HEX as CollectionId,
    bytesToHex(memberKey) as Key[1],
    { at: 'best' }
  )
}

async function queuedKeys(api: PeopleApi): Promise<number> {
  const entries = await api.query.Members.OnboardingQueue.getEntries(
    LITE_COLLECTION_HEX as CollectionId
  )
  return entries.reduce((n, e) => n + e.value.length, 0)
}

/** Register `account` as a lite person proving `entropy`'s key, unless it already is one. */
async function registerLite(
  api: PeopleApi,
  account: Account,
  entropy: Uint8Array,
  label: string
): Promise<void> {
  const memberKey = member_from_entropy(entropy)
  const existing = await api.query.PeopleLite.LitePeople.getValue(account.address, { at: 'best' })
  if (existing) {
    if (existing.ring_vrf_key.toLowerCase() !== bytesToHex(memberKey).toLowerCase()) {
      throw new Error(
        `${label} ${account.address} is a lite person under ring key ${existing.ring_vrf_key}, not the one this phrase derives`
      )
    }
    return
  }
  const message = concatBytes(REGISTER_MSG_PREFIX, account.publicKey, memberKey)
  const proof = sign(entropy, message)
  if (!verify_signature(proof, message, memberKey)) {
    throw new Error(`${label}: proof of ownership does not verify locally`)
  }
  type Args = Parameters<typeof api.tx.PeopleLite.register_with_fee>[0]
  const tx = api.tx.PeopleLite.register_with_fee({
    ring_vrf_key: bytesToHex(memberKey),
    proof_of_ownership: bytesToHex(proof)
  } as Args)
  await submit(`${label} register_with_fee`, tx, account.signer)
  console.log(`[lite-personhood] ${label} ${account.address} registered as a lite person`)
}

async function fundFiller(api: PeopleApi, from: Account, to: Account): Promise<void> {
  const free = (await api.query.System.Account.getValue(to.address, { at: 'best' })).data.free
  if (free >= FILLER_NEED) return
  const tx = api.tx.Balances.transfer_keep_alive({
    dest: { type: 'Id', value: to.address },
    value: FILLER_NEED - free
  })
  await submit(`fund filler ${to.address}`, tx, from.signer)
}

/**
 * Block until the funder's key is covered by a built lite ring that Asset Hub
 * has synced, which is what a PGAS claim proves against.
 */
async function waitForRing(
  { people, ah }: Omit<ReturnType<typeof clients>, 'dispose'>,
  memberKey: Uint8Array
): Promise<void> {
  const deadline = Date.now() + RING_WAIT_MS
  let last = ''
  for (;;) {
    const pos = await position(people, memberKey)
    let pending: string | null = null
    if (!pos) pending = 'key not in the lite collection'
    else if (pos.type === 'Onboarding') {
      pending = `queued for onboarding, ${await queuedKeys(people)} key(s) in the queue`
    } else if (pos.type === 'Included') {
      const { ring_index: ringIndex, ring_position: ringPosition } = pos.value
      const status = await people.query.Members.RingKeysStatus.getValue(
        LITE_COLLECTION_HEX as CollectionId,
        ringIndex,
        { at: 'best' }
      )
      if (status.included <= ringPosition) {
        pending = `ring ${ringIndex} root covers ${status.included}/${status.total} keys, ours is at ${ringPosition}`
      } else {
        const collection = await ah.constants.AliasAccounts.PeopleLiteCollectionIdentifier()
        const generation = await ah.query.MembersSubscriber.CurrentGeneration.getValue({
          at: 'best'
        })
        type RootsKey = Parameters<typeof ah.query.MembersSubscriber.RingRoots.getValue>
        const roots = await ah.query.MembersSubscriber.RingRoots.getValue(
          generation,
          collection as RootsKey[1],
          ringIndex,
          { at: 'best' }
        )
        if (!roots || roots.length === 0)
          pending = `ring ${ringIndex} built, Asset Hub has not synced its root yet`
      }
    } else {
      throw new Error(`lite key is ${pos.type} in the collection`)
    }
    if (pending === null) return
    if (pending !== last) {
      console.log(`[lite-personhood] waiting: ${pending}`)
      last = pending
    }
    if (Date.now() > deadline) {
      throw new Error(`lite ring not usable after ${RING_WAIT_MS / 60_000} min: ${pending}`)
    }
    await new Promise((resolve) => setTimeout(resolve, RING_POLL_MS))
  }
}

/**
 * Make the funder a lite person covered by a synced ring, registering it and
 * any fillers the cohort still needs. Needs about 230 PAS on the People chain
 * for a fresh cohort; the autodeployer tops the funder up there after a wipe.
 */
export async function ensureLitePersonhood(): Promise<void> {
  const entropy = liteMemberEntropy()
  const memberKey = member_from_entropy(entropy)
  const { people, ah, dispose } = clients()
  try {
    const pos = await position(people, memberKey)
    if (pos?.type !== 'Included') {
      const funder = master()
      const free = (await people.query.System.Account.getValue(funder.address, { at: 'best' })).data
        .free
      const need = FILLER_NEED * BigInt(COHORT_SIZE)
      if (free < need) {
        throw new Error(
          `funder ${funder.address} holds ${free} on the People chain, below the ${need} a lite registration cohort needs. ` +
            'Top it up there (the autodeployer funds it as a `chain: people` entry).'
        )
      }
      await registerLite(people, funder, entropy, 'funder')
      const queued = await queuedKeys(people)
      for (let i = 0; i < COHORT_SIZE - Math.min(queued, COHORT_SIZE); i++) {
        const account = filler(i)
        await fundFiller(people, funder, account)
        await registerLite(people, account, fillerEntropy(i), `filler ${i}`)
      }
    }
    await waitForRing({ people, ah }, memberKey)
  } finally {
    dispose()
  }
}
