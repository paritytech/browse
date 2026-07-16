import { DEV_PHRASE as STD_DEV_PHRASE } from '@polkadot-labs/hdkd-helpers'

import { LOCALHOST_SELF_DOTNS } from '../../src/lib/config'
import { identityUsername, identityUri } from '../utils'
import { createDevSigner, fundWithNative, fundWithPgas, mapAccount, PGAS_SEED_AMOUNT } from './fund'

type Account = import('@parity/host-api-test-sdk').Account

/** Pins the connected per-run identity to the run username and its run-unique wallet path. */
export const IDENTITY_ACCOUNT: Account = { name: identityUsername(), uri: identityUri() }

export interface UnboundProduct {
  /** Host product-account map pinning the app product account (index 0) to the funded, never-bound account. */
  productAccounts: Record<string, Account>
  /** Dev derivation tag of the funded account, for reclaiming its PGAS afterwards. */
  tag: string
}

/**
 * Derive and fund a fresh product account that has never bound on the active
 * resolver, mapped as the app product account (`${LOCALHOST_SELF_DOTNS}/0`).
 * The connected identity is unchanged, so recommending through it runs the
 * bind-and-attest batch (the attester is unbound) instead of a plain attest.
 * PGAS lets `ensureAllowance` skip the grant. Native covers the batch tx fees.
 */
export async function createUnboundProductAccount(): Promise<UnboundProduct> {
  const tag = `Unbound${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const product = createDevSigner(tag)
  await fundWithNative(product.address)
  await mapAccount(tag)
  // Fund the account so it can pay its first-recommend batch fee in PGAS.
  await fundWithPgas(tag, PGAS_SEED_AMOUNT)
  return {
    tag,
    productAccounts: {
      [`${LOCALHOST_SELF_DOTNS}/0`]: { name: tag, uri: `${STD_DEV_PHRASE}//${tag}` }
    }
  }
}
