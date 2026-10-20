import type { DevAccount } from '@parity/truapi-host/testing/playwright'

import { identityEntropy, identityUsername } from '../utils'
import { createDevSigner, fundWithNative, fundWithPgas, mapAccount, PGAS_SEED_AMOUNT } from './fund'

/**
 * The connected per-run identity. The host activates its session from the run
 * entropy and reports the name as its username, which the run registers for
 * that identity in globalSetup.
 */
export const IDENTITY_ACCOUNT: DevAccount = {
  name: identityUsername(),
  entropy: identityEntropy()
}

export interface UnboundProduct {
  /** Dev derivation tag of the funded account, for signing as it and reclaiming its PGAS afterwards. */
  tag: string
}

/**
 * Derive and fund a fresh account that has never bound on the active resolver.
 * A fixture binds it to the connected identity and attests through it, so it
 * stands for a second product account of that identity. PGAS lets it pay its
 * contract calls. Native covers the batch tx fees.
 */
export async function createUnboundProductAccount(): Promise<UnboundProduct> {
  const tag = `Unbound${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const product = createDevSigner(tag)
  await fundWithNative(product.address)
  await mapAccount(tag)
  await fundWithPgas(product.address, PGAS_SEED_AMOUNT)
  return { tag }
}
