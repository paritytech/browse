/**
 * Memoised derivation of the current user's EVM H160 from their Substrate signer.
 *
 * Session-scoped: the first successful derivation is cached for the lifetime of
 * the tab. `null` results are not cached, so a later sync after the host bridge
 * becomes available still derives correctly.
 */

import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { AccountId, type SS58String } from 'polkadot-api'

import { attestationService } from '../../lib/attestation-service'

let cached: `0x${string}` | null = null

/** Return the caller's EVM H160, or `null` if no signer is available. */
export async function resolveUserH160(): Promise<`0x${string}` | null> {
  if (cached) return cached
  try {
    const { publicKey } = await attestationService.getSigner()
    const ss58 = AccountId().dec(publicKey)
    cached = ss58ToEthereum(ss58 as SS58String) as `0x${string}`
    return cached
  } catch {
    return null
  }
}
