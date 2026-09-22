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
  // The dev server builds the client on its first request, which the first spec
  // would otherwise wait out on top of its own cold start.
  await fetch(APP_URL).catch(() => undefined)
}
