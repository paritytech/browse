/**
 * Memoised derivation of the current user identity account (H160).
 *
 * Recommendations are signed by a product account but the resolver ties them to
 * the identity account the product account is bound to. A user may recommend
 * from several product accounts, such as localhost versus prod or a second
 * device, all bound to the same identity. So "have I recommended this?" is an
 * identity question, answered against the resolver identity-keyed index.
 *
 * Session-scoped: cached once the binding resolves to a non-zero identity. It is
 * zero until the first recommendation binds a product account.
 */

import { attestationService } from '../../lib/attestation-service'

let cachedIdentityH160: `0x${string}` | null = null

/**
 * Ceiling on how long a caller waits for the identity. The host account
 * request behind the lookup can sit pending indefinitely on a host whose
 * account is disconnected, and identity only decorates reads with "you
 * recommended this", so no caller may block on it.
 */
const IDENTITY_RESOLVE_TIMEOUT_MS = 3_000

/**
 * The bound identity account for the caller, or `null` when unbound,
 * unavailable, or not resolved within the timeout. A late resolution still
 * lands in the session cache, so the next call answers instantly.
 */
export function resolveIdentityH160(): Promise<`0x${string}` | null> {
  if (cachedIdentityH160) return Promise.resolve(cachedIdentityH160)
  return Promise.race([
    lookupIdentityH160(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), IDENTITY_RESOLVE_TIMEOUT_MS))
  ])
}

async function lookupIdentityH160(): Promise<`0x${string}` | null> {
  try {
    const product = await attestationService.productH160()
    const identityH160 = (await attestationService.identityOf(product)).toLowerCase()
    if (BigInt(identityH160) !== 0n) cachedIdentityH160 = identityH160 as `0x${string}`
    return cachedIdentityH160
  } catch {
    return null
  }
}
