/**
 * Test fixture: submit real on-chain attestations using polkadot-api.
 *
 * Creates an AttestationRegistryService with a direct WebSocket connection
 * and dev account signer, bypassing the browser SDK.
 */

import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { createClient } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws-provider/node'

import { AttestationRegistryService } from '../../src/lib/attestation-registry'

const RPC_ENDPOINTS = [
  'wss://sys.ibp.network/asset-hub-paseo',
  'wss://asset-hub-paseo.dotters.network',
  'wss://asset-hub-paseo-rpc.dwellir.com'
]

function createDevSigner(name: string) {
  const miniSecret = mnemonicToMiniSecret(DEV_PHRASE, '')
  const derive = sr25519CreateDerive(miniSecret)
  const wallet = derive(`//${name}`)

  return {
    signer: getPolkadotSigner(wallet.publicKey, 'Sr25519', async (input: Uint8Array) =>
      wallet.sign(input)
    ),
    address: ss58Encode(wallet.publicKey, 42)
  }
}

async function withChainService<T>(
  devAccount: string,
  fn: (service: AttestationRegistryService, address: string) => Promise<T>
): Promise<T> {
  const { signer, address } = createDevSigner(devAccount)

  let client: ReturnType<typeof createClient> | null = null
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const provider = getWsProvider(endpoint)
      client = createClient(provider)
      await client.getFinalizedBlock()
      break
    } catch {
      client = null
    }
  }

  if (!client) throw new Error('Could not connect to any RPC endpoint')

  try {
    const api = client.getUnsafeApi()
    const service = new AttestationRegistryService(
      async () => api,
      async () => ({ signer, origin: address })
    )
    return await fn(service, address)
  } finally {
    client.destroy()
  }
}

interface AttestResult {
  success: boolean
  signerAddress: string
}

/**
 * Submit an attestation for `label.dot` from the given dev account.
 * Returns the signer's SS58 address (to use as a contact in tests).
 */
export async function attestFromDev(label: string, devAccount = 'Alice'): Promise<AttestResult> {
  return withChainService(devAccount, async (service, address) => {
    await service.attest(label)
    return { success: true, signerAddress: address }
  })
}

/**
 * Revoke an attestation for `label.dot` from the given dev account.
 */
export async function revokeFromDev(label: string, devAccount = 'Alice'): Promise<void> {
  await withChainService(devAccount, async (service) => {
    await service.revoke(label)
  })
}
