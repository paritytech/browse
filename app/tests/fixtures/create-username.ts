/**
 * Registers the username the per-run identity reveals on a first recommendation.
 *
 * Previewnet personhood is sudo-minted, so a throwaway per-run key owns no name.
 * The resolver never checks personhood, so it is enough to sudo-write the
 * `Resources.UsernameOwnerOf` entry the app reads, through a proxy of the sudo
 * account so the sudo key stays out of CI.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { previewnetpeople } from '@polkadot-api/descriptors'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { Binary, createClient, Enum, type TypedApi } from 'polkadot-api'
import { getPolkadotSigner, type PolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'
import { bytesToHex, hexToBytes } from 'viem'

import { NETWORK } from '../../src/lib/config'
import { identityUsername } from '../utils'
import { createMasterSigner, createProductSigner } from './fund'

// The app resolves usernames from this People chain.
const PEOPLE_RPC = NETWORK.PEOPLE_RPCS![0]

// The proxy acts for this previewnet People sudo account, which is public.
const SUDO_SS58 = '5DFsPMSY4jgZf9m8NKoZAhv5C2xcVSepTRYitaTwMULt8R5Y'

// A plain People-chain call must set its VerifyMultiSignature extension to Disabled.
const SIGN_OPTIONS = {
  customSignedExtensions: { VerifyMultiSignature: { value: Enum('Disabled') } }
}

type PeopleApi = TypedApi<typeof previewnetpeople>

let cachedProxySigner: PolkadotSigner | undefined

/** Reads the proxy secret from the environment, or the repo root `.env` for local runs. */
function readProxySecretHex(): string | undefined {
  const fromEnv = process.env.PROXY_PRIVATE_KEY?.trim()
  if (fromEnv) return fromEnv
  try {
    const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')
    const line = readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.trimStart().startsWith('PROXY_PRIVATE_KEY='))
    if (!line) return undefined
    const value = line.slice(line.indexOf('=') + 1).trim()
    return value.replace(/^['"]|['"]$/g, '') || undefined
  } catch {
    return undefined
  }
}

/** Build the proxy signer from its 32-byte sr25519 seed, or undefined when unset. */
function proxySigner(): PolkadotSigner | undefined {
  if (cachedProxySigner) return cachedProxySigner
  const hex = readProxySecretHex()
  if (!hex) return undefined
  const seed = hexToBytes(hex.startsWith('0x') ? (hex as `0x${string}`) : `0x${hex}`)
  if (seed.length !== 32) {
    throw new Error(`PROXY_PRIVATE_KEY must be a 32 byte sr25519 seed, got ${seed.length} bytes`)
  }
  const wallet = sr25519CreateDerive(seed)('')
  cachedProxySigner = getPolkadotSigner(wallet.publicKey, 'Sr25519', async (msg) =>
    wallet.sign(msg)
  )
  return cachedProxySigner
}

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
    } catch {
      // ignore teardown errors
    }
  }
}

/** Returns the storage key for `Resources.UsernameOwnerOf[username]`, keyed as the app reads it. */
function usernameKey(api: PeopleApi): Promise<string> {
  return api.query.Resources.UsernameOwnerOf.getKey(Binary.fromText(identityUsername()))
}

/** Dispatch `call` as the sudo account through the proxy, awaiting inclusion. */
async function submitAsSudo(
  api: PeopleApi,
  signer: PolkadotSigner,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any,
  label: string
): Promise<void> {
  const proxied = api.tx.Proxy.proxy({
    real: { type: 'Id', value: SUDO_SS58 },
    force_proxy_type: undefined,
    call: api.tx.Sudo.sudo({ call }).decodedCall
  })
  const result = await proxied.signAndSubmit(signer, SIGN_OPTIONS)
  if (!result.ok) {
    throw new Error(`${label} failed: ${JSON.stringify(result.dispatchError)}`)
  }
}

/**
 * Writes the username mapping, once per run via globalSetup. A no-op locally,
 * where the identity is the master that already owns `smalltava.05`, and when
 * the proxy secret is absent.
 */
export async function createUsername(): Promise<void> {
  const identity = createProductSigner()
  if (identity.address === createMasterSigner().address) return
  const signer = proxySigner()
  if (!signer) {
    console.warn(
      '[create-username] PROXY_PRIVATE_KEY is not set, so the per-run username was not registered and the identity-reveal recommendation will fail'
    )
    return
  }
  await withPeopleApi(async (api) => {
    const key = await usernameKey(api)
    const value = bytesToHex(identity.publicKey)
    const setTx = api.tx.System.set_storage({
      items: [[Binary.fromHex(key), Binary.fromHex(value)]]
    })
    await submitAsSudo(api, signer, setTx.decodedCall, `set username ${identityUsername()}`)
  })
}

/** Removes the username mapping on teardown. A no-op locally and when the proxy secret is absent. */
export async function removeUsername(): Promise<void> {
  const identity = createProductSigner()
  if (identity.address === createMasterSigner().address) return
  const signer = proxySigner()
  if (!signer) return
  await withPeopleApi(async (api) => {
    const key = await usernameKey(api)
    const killTx = api.tx.System.kill_storage({ keys: [Binary.fromHex(key)] })
    await submitAsSudo(api, signer, killTx.decodedCall, `remove username ${identityUsername()}`)
  })
}
