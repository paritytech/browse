import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { DEV_PHRASE, mnemonicToMiniSecret, ss58Encode } from '@polkadot-labs/hdkd-helpers'
import { paseoHub } from '@polkadot-api/descriptors'
import { createClient } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws-provider/node'

import { AttestationService } from '../../src/lib/attestation-service'

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
    address: ss58Encode(wallet.publicKey, 42),
    publicKey: wallet.publicKey
  }
}

export async function withAttestationService<T>(
  devAccount: string,
  fn: (service: AttestationService, address: string) => Promise<T>
): Promise<T> {
  const { signer, address, publicKey } = createDevSigner(devAccount)

  const client = createClient(getWsProvider(RPC_ENDPOINTS))

  try {
    const api = client.getTypedApi(paseoHub)
    const service = new AttestationService(
      async () => api,
      async () => ({ signer, origin: address, publicKey }),
      false
    )
    return await fn(service, address)
  } finally {
    client.destroy()
  }
}
