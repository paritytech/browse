import { removeUsername } from './fixtures/create-username'
import { reclaimIdentity } from './fixtures/fund'

/**
 * Clear the run username mapping and sweep the per-run identity balances back to
 * the shared master once the run finishes, so each run leaves no stale username
 * entry and does not strand native and PGAS. Best-effort: a failure is logged,
 * not thrown.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    await removeUsername()
  } catch (e) {
    console.error('globalTeardown: username removal failed:', e)
  }
  try {
    await reclaimIdentity()
  } catch (e) {
    console.error('globalTeardown: identity reclaim failed:', e)
  }
}
