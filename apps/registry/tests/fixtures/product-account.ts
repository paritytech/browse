/**
 * The account a host gives the product to sign contract writes with.
 *
 * TrUAPI derives it from the session root and the product id, so it cannot be
 * pinned to a chosen account, and every session root gets a different one. A
 * real host mints PGAS into it on a SmartContractAllowance grant. The test host
 * grants the allowance but mints nothing, so the suite pays instead.
 */
import { productAccountAddress, type DevAccount } from '@parity/truapi-host/testing/playwright'

import { LOCALHOST_SELF_DOTNS } from '../../src/lib/config'
import { fundWithNative, fundWithPgas } from './fund'

/**
 * What a product account is given, in PGAS. Sized per host: a write costs
 * roughly 2, and nothing can hand the balance back, since only the host holds
 * the key. The funder claims a capped amount a day, so this is not free.
 */
const DEFAULT_PRODUCT_PGAS = 12_000_000_000n

/**
 * Fund the product account a host signed in as `account` hands the app, and
 * return its address. The address comes from the derivation the host uses, so
 * it is the account the app signs with. Idempotent: the
 * funders skip an account that is already above their threshold.
 */
export async function fundProductAccount(
  account: DevAccount,
  pgas: bigint = DEFAULT_PRODUCT_PGAS
): Promise<string> {
  const address = await productAccountAddress({ account, productId: LOCALHOST_SELF_DOTNS })
  await fundWithNative(address)
  await fundWithPgas(address, pgas)
  return address
}
