import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { createIdentitySigner } from './fund'
import { AttestationService } from '../../src/lib/attestation-service'
import { NETWORK } from '../../src/lib/config'

const RPC_ENDPOINTS = [...NETWORK.ASSETHUB_RPCS]

type Credentials = ReturnType<typeof createIdentitySigner>

export async function withSigner<T>(
  { signer, address, publicKey }: Credentials,
  fn: (service: AttestationService, address: string) => Promise<T>
): Promise<T> {
  // The per-run identity is funded and bound once up front by fundIdentity in
  // the globalSetup, and dev signers are funded by their own fixtures, so no
  // per-call top-up is needed here.
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

/** Run `fn` with a service signed by the bound product account (see {@link createIdentitySigner}). */
export function withAttestationService<T>(
  fn: (service: AttestationService, address: string) => Promise<T>
): Promise<T> {
  return withSigner(createIdentitySigner(), fn)
}
