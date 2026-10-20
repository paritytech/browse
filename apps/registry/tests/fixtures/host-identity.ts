/**
 * Confirm the identity the fixtures sign as is the one the host signs as.
 *
 * The host keeps the identity key, and the fixtures need it to fund, register
 * and bind the identity, so createIdentitySigner derives it from the run
 * entropy the way the core does. A derivation that drifts from the one in the
 * core is not refused anywhere: every address the suite funds and every
 * username it registers would belong to an account the host never signs with,
 * and the recommend specs would fail far from the cause. So before the run
 * identity is funded, boot a host on it, read back the identity it reports, and
 * stop the run if the two differ.
 */
import { type Browser, chromium } from '@playwright/test'
import { bytesToHex } from 'viem'

import { navigateToTestHost, startSignedHost } from '../utils'
import { IDENTITY_ACCOUNT } from './bind-identity'
import { createIdentitySigner } from './fund'

/** The `identityAccountId` the host reports for its active session, as hex. */
async function reportedIdentity(): Promise<string> {
  const host = await startSignedHost(IDENTITY_ACCOUNT)
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ ignoreHTTPSErrors: true })
    await navigateToTestHost(page, host.url)
    const reported = await page.waitForFunction(
      () => {
        type Connected = { tag: string; value?: { identityAccountId?: Uint8Array | string } }
        const states =
          (
            window as unknown as { __TEST_HOST__?: { authStates?: () => Connected[] } }
          ).__TEST_HOST__?.authStates?.() ?? []
        const id = [...states].reverse().find((state) => state.tag === 'Connected')
          ?.value?.identityAccountId
        if (id === undefined) return undefined
        return typeof id === 'string'
          ? id
          : `0x${Array.from(id, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
      },
      undefined,
      { timeout: 60_000 }
    )
    return ((await reported.jsonValue()) as string).toLowerCase()
  } finally {
    await browser?.close()
    await host.close()
  }
}

/** Throw unless the host signs as the identity createIdentitySigner derives. */
export async function assertHostIdentity(): Promise<void> {
  const derived = bytesToHex(createIdentitySigner().publicKey).toLowerCase()
  const reported = await reportedIdentity()
  if (reported !== derived) {
    throw new Error(
      `the test host signs as identity ${reported}, but the fixtures derive ${derived} ` +
        'from the same entropy. Fix identityKeyFor in fixtures/fund.ts before funding ' +
        'or registering anything with it.'
    )
  }
}
