import { reclaimIdentity } from './fund'

/**
 * Sweep the per-run identity balances back to the shared master once the run
 * finishes, so a fresh identity does not strand native and PGAS. Its username
 * stays: it is unique to the run and registered with the identity itself.
 * Best-effort: a failure is logged, not thrown.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    await reclaimIdentity()
  } catch (e) {
    console.error('globalTeardown: identity reclaim failed:', e)
  }
}
