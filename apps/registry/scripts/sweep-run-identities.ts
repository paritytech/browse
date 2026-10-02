/**
 * Sweep the PGAS that past e2e runs left on their per-run identities back to the funder.
 *
 * Each run derives its identity from its run id, `GITHUB_RUN_ID` in CI or
 * `E2E_RUN_ID` locally, so the id alone recovers the key. A local run username
 * encodes its id with digits mapped to letters, `a` for 0 through `j` for 9.
 * Pass only finished runs, since sweeping a run in progress drains the identity
 * it is attesting with. `gh run list --workflow e2e.yml --status completed`
 * lists CI run ids.
 *
 *   cd app && NETWORK_GENESIS_HASH=<genesis> bun scripts/sweep-run-identities.ts 36703277581 692079717
 */

import { reclaimIdentity } from '../tests/fixtures/fund'

const runIds = process.argv.slice(2)
if (runIds.length === 0) {
  console.error('Usage: bun scripts/sweep-run-identities.ts <run id>...')
  process.exit(1)
}

for (const runId of runIds) {
  process.env.GITHUB_RUN_ID = runId
  await reclaimIdentity()
  console.log(`swept run ${runId}`)
}
process.exit(0)
