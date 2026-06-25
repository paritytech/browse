import {
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS,
  SUMMIT_ASSETHUB_GENESIS
} from '@parity/browse-sdk'
import { paseohub, previewnethub, summithub } from '@polkadot-api/descriptors'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { createProductSigner } from './fund'
import { AttestationService } from '../../src/lib/attestation-service'
import { ASSETHUB_GENESIS, NETWORK } from '../../src/lib/config'

const RPC_ENDPOINTS = [...NETWORK.ASSETHUB_RPCS]

// Match the chain descriptor to the active network (see client.ts).
const descriptor = ({
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: paseohub,
  [PREVIEWNET_ASSETHUB_GENESIS]: previewnethub,
  [SUMMIT_ASSETHUB_GENESIS]: summithub
}[ASSETHUB_GENESIS] ?? paseohub) as typeof paseohub

type Credentials = ReturnType<typeof createProductSigner>

async function withSigner<T>(
  { signer, address, publicKey }: Credentials,
  fn: (service: AttestationService, address: string) => Promise<T>
): Promise<T> {
  const client = createClient(
    getWsProvider(RPC_ENDPOINTS, {
      websocketClass: WebSocket as unknown as typeof globalThis.WebSocket
    })
  )

  try {
    const api = client.getTypedApi(descriptor)
    const service = new AttestationService(
      async () => api,
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
