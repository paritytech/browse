import { createUsername } from './create-username'
import { ensureContracts } from './ensure-contracts'
import { fundIdentity } from './fund'

/**
 * Prepare the per-run identity once before the suite: fund it native and PGAS
 * from the shared master, self-bind it on the resolver, and register its run
 * username on the People chain, so every spec can attest as a fresh identity
 * that no dead account has locked and can reveal a name on a first recommend.
 */
export default async function globalSetup(): Promise<void> {
  ensureContracts()
  await fundIdentity()
  // The username is still written through the sudo proxy, the one step a
  // funded wallet cannot do for itself. When the proxy cannot pay, the run
  // goes on and only the specs that reveal a username fail.
  try {
    await createUsername()
  } catch (e) {
    console.warn('[create-username] skipped, the sudo proxy could not write the username:', e)
  }
}
