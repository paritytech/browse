import { paseoHub } from '@polkadot-api/descriptors'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

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

  const client = createClient(
    getWsProvider(RPC_ENDPOINTS, {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )

  try {
    const api = client.getTypedApi(paseoHub)
    const service = new AttestationService(
      async () => api,
      async () => client,
      async () => ({ signer, origin: address, publicKey }),
      false
    )
    return await fn(service, address)
  } finally {
    // papi 2.x throws a synchronous DisjointError if a chainHead follow is
    // still active when the client is destroyed; harmless during teardown.
    try {
      client.destroy()
    } catch {
      // ignore
    }
  }
}
