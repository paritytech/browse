/**
 * The account a host gives the product to sign contract writes with.
 *
 * From host-api-test-sdk 0.13 the core derives it as a soft child of the
 * subtree the host names, so no test can work out the address from the account
 * it mapped. A real host mints PGAS into it on a SmartContractAllowance grant;
 * the test host grants the allowance but mints nothing, so the suite pays
 * instead, and the app reports the address it was handed.
 */
import type { Browser } from '@playwright/test'

import { getProductFrame, navigateToTestHost } from '../utils'
import { fundAddressWithPgas, fundWithNative } from './fund'

/** Enough PGAS for the contract writes one spec file makes. */
const PRODUCT_PGAS_AMOUNT = 10_000_000_000n

/**
 * Fund the product account behind `hostUrl`, whatever the host derived it to
 * be. Idempotent: the funders skip an account that is already above their
 * threshold.
 */
export async function fundProductAccount(browser: Browser, hostUrl: string): Promise<string> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  try {
    const page = await context.newPage()
    await navigateToTestHost(page, hostUrl)
    const frame = await getProductFrame(page, '.category-tab')
    const address = await frame.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const deadline = Date.now() + 20_000
          const poll = () => {
            const account = window.__productAccount
            if (account) return resolve(account)
            if (Date.now() > deadline)
              return reject(new Error('the app reported no product account'))
            setTimeout(poll, 100)
          }
          poll()
        })
    )
    await fundWithNative(address)
    await fundAddressWithPgas(address, PRODUCT_PGAS_AMOUNT)
    return address
  } finally {
    await context.close()
  }
}
