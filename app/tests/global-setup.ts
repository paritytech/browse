import { createUsername } from './fixtures/create-username'
import { fundIdentity } from './fixtures/fund'

/**
 * Prepare the per-run identity once before the suite: fund it native and PGAS
 * from the shared master, self-bind it on the resolver, and register its run
 * username on the People chain, so every spec can attest as a fresh identity
 * that no dead account has locked and can reveal a name on a first recommend.
 */
export default async function globalSetup(): Promise<void> {
  await fundIdentity()
  await createUsername()
}
