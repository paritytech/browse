import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { createProductSigner } from './fund'
import { AttestationService } from '../../src/lib/attestation-service'
import { NETWORK } from '../../src/lib/config'

const RPC_ENDPOINTS = [...NETWORK.ASSETHUB_RPCS]

type Credentials = ReturnType<typeof createProductSigner>

export async function withSigner<T>(
  { signer, address, publicKey }: Credentials,
  fn: (service: AttestationService, address: string) => Promise<T>
): Promise<T> {
  const client = createClient(
    getWsProvider(RPC_ENDPOINTS, {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )

  try {
    const service = new AttestationService(
      async () => client,
      async () => ({ signer, origin: address, publicKey }),
      false
    )
    return await fn(service, address)
  } finally {
    // papi 2.x throws a synchronous DisjointError if a chainHead follow is
    // still active when the client is destroyed. Harmless during teardown.
    try {
      client.destroy()
    } catch {
      // ignore
    }
  }
}

/** Run `fn` with a service signed by the bound product account (see {@link createProductSigner}). */
export function withAttestationService<T>(
  fn: (service: AttestationService, address: string) => Promise<T>
): Promise<T> {
  return withSigner(createProductSigner(), fn)
}
