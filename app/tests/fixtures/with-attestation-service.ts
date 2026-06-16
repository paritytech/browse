import {
  PASEO_ASSET_HUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSET_HUB_GENESIS,
  SUMMIT_ASSET_HUB_GENESIS
} from '@parity/browse-sdk'
import { paseohub, previewnethub, summithub } from '@polkadot-api/descriptors'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { WebSocket } from 'ws'

import { createDevSigner } from './fund'
import { AttestationService } from '../../src/lib/attestation-service'
import { ASSET_HUB_GENESIS, NETWORK } from '../../src/lib/config'

const RPC_ENDPOINTS = [...NETWORK.rpcs]

// Match the chain descriptor to the active network (see client.ts).
const descriptor = ({
  [PASEO_ASSET_HUB_NEXT_V2_GENESIS]: paseohub,
  [PREVIEWNET_ASSET_HUB_GENESIS]: previewnethub,
  [SUMMIT_ASSET_HUB_GENESIS]: summithub
}[ASSET_HUB_GENESIS] ?? paseohub) as typeof paseohub

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
    // still active when the client is destroyed; harmless during teardown.
    try {
      client.destroy()
    } catch {
      // ignore
    }
  }
}
