import { createUsername } from './create-username'
import { ensureContracts } from './ensure-contracts'
import { ensureFixtureApps } from './ensure-fixture-apps'
import { fundIdentity } from './fund'
import { APP_URL } from '../utils'

/**
 * Prepare the per-run identity once before the suite: fund it native and PGAS
 * from the shared master, self-bind it on the resolver, and register its run
 * username on the People chain, so every spec can attest as a fresh identity
 * that no dead account has locked and can reveal a name on a first recommend.
 */
export default async function globalSetup(): Promise<void> {
  ensureContracts()
  await ensureFixtureApps()
  await fundIdentity()
  await createUsername()
  await warmClient()
}

/**
 * Load the client once so the first spec does not wait for it.
 *
 * The dev server transforms a module the first time a browser asks for it, so
 * the first page of a run pays for the whole graph on top of its own cold start.
 * Failures here are not worth failing the suite over: the specs pay the cost
 * themselves if this does not land.
 */
async function warmClient(): Promise<void> {
  try {
    const { chromium } = await import('@playwright/test')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ ignoreHTTPSErrors: true })
      await page.goto(APP_URL, { waitUntil: 'load', timeout: 120_000 })
      await page.waitForTimeout(2_000)
    } finally {
      await browser.close()
    }
  } catch {
    // a warm-up that will not run is not a reason to stop
  }
}
