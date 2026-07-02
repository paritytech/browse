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

/** The bound identity account for the caller, or `null` when unbound/unavailable. */
export async function resolveIdentityH160(): Promise<`0x${string}` | null> {
  if (cachedIdentityH160) return cachedIdentityH160
  try {
    const product = await attestationService.productH160()
    const identityH160 = (await attestationService.identityOf(product)).toLowerCase()
    if (BigInt(identityH160) !== 0n) cachedIdentityH160 = identityH160 as `0x${string}`
    return cachedIdentityH160
  } catch {
    return null
  }
}
