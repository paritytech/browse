import { paseoHub } from '@polkadot-api/descriptors'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws-provider/node'

import { createDevSigner } from './fund'
import { AttestationService } from '../../src/lib/attestation-service'

const RPC_ENDPOINTS = [
  'wss://sys.ibp.network/asset-hub-paseo',
  'wss://asset-hub-paseo.dotters.network',
  'wss://asset-hub-paseo-rpc.dwellir.com'
]

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
