# Developer portal backlog

Execution state for the drive to Vercel parity. The story catalog with full
acceptance criteria lives in USER-STORIES.md. One story per loop iteration.

## Done

- Loads inside the Parity host via `@parity/product-sdk/host`, smoke tests green
  (`tests/app-start.spec.ts`).
- Vercel-style shell: sidebar, search plus grid and list toolbar, product card
  grid, add page at `/publish`.
- Snapshot autocompletion on the add page from the verifiable domains snapshot.
- Add a domain: login on first publish, ownership and personhood failures
  surface as decoded errors, success returns to the grid.
- Project detail route `/d/<label>` skeleton: header, tabs, placeholder bodies.
- Story catalog written (USER-STORIES.md), e2e switched to paseo-next-v2, and
  the `gotoDetail` and `seedSnapshotPreimage` helpers added to `tests/utils.ts`.
- US1 add-domain spec restructure: `tests/domains.spec.ts` covers suggestions
  from the seeded snapshot fixture, normalization through a mixed case prefix,
  suggestion select, the disabled empty state, and the cannot-publish error
  with an empty signing log. The owner fixture happy path is written and skips
  without the env gate. `tests/snapshot-fixture.ts` keeps the seeded bytes and
  `APP_DOMAINS_SNAPSHOT_CID` in lockstep from the playwright config.
  `app-start.spec.ts` is smoke only again.
- US11 analytics enable panel: the Analytics tab renders the enable layout
  from the captured reference, with a disabled Enable button, the Visitors,
  Page Views, and Bounce Rate labels over honest No data values, benefit
  cards, and copy stating no metrics source exists for .dot apps yet. The
  spec asserts the panel contains no digits at all. Covered in
  `tests/detail.spec.ts`.
- US8 rejection paths: the failed add now also asserts the permission log
  stays empty, and a new unauthenticated host test proves an add fails before
  anything signs. The login reject message cannot be staged because
  `setLoginBehavior` in host-api-test-sdk 0.10 does not gate the product-sdk
  0.19 `requestLogin`, recorded as an upstream gap. A probe of all 37209 paseo
  usernames found none owning a published label, so the permission gate paths
  stay behind the owner fixture. The iteration also made modality reads lazy
  on the Domains tab and gave the empty label specs their own host, which
  removed the tail of session read stalls the suite kept retrying through.
- US10 deployments history and revert: every visit records the observed CID,
  its raw contenthash payload, and the manifest version to the host local
  storage history, deduped for repeat observations. The new Deployments tab
  lists entries newest first with the Current pill, a source tag, and a two
  step Rollback that replays the recorded payload through `writeContenthash`.
  The hero Rollback jumps here once a second entry exists. Covered in
  `tests/detail.spec.ts`: observed capture, dedupe on revisit, the honest
  local history empty state, and no rollback on the current entry. Both
  revert paths are tier B because a second entry only exists after a
  successful write and the mock host cannot seed the storage.
- US7 settings edits through dotNS records: the write pipeline moved into a
  shared `submitReviveCall` in `lib/publisher.ts`, and `lib/records.ts` gained
  `writeProjectMetadata` (the `$v: 1` manifest plus the legacy name and
  description records, each dry run gated) and `writeContenthash` for US10.
  The Settings tab renders Display Name, Description, and Icon cards prefilled
  from the live records. Picking an icon submits its bytes to the host
  preimage store and previews them back through the lookup, showing the
  computed CID. A save without authority surfaces the decoded error in the
  card footer with nothing signed. Successful edits append to the new
  `lib/history.ts` store with source `edit`. Covered in `tests/detail.spec.ts`.
  Playwright now retries once because parallel host handshakes and live reads
  flake under load.
- US4 publish and unpublish from detail: the Settings tab carries a danger
  card whose unpublish needs a two step confirm, and the hero grows a Publish
  action when the label is not published. Both run identity, dry run, and
  submit through `submitPublish`, with the outcome shown inline. The error
  path and the empty signing log are covered in `tests/detail.spec.ts`. The
  owned lifecycle happy path stays env gated and is deliberately not written
  as a spec because it would unpublish a real domain without an explicit opt
  in. The iteration also fixed three invalid design token references that
  left the hero, settings, and domains cards transparent and the header
  skeleton invisible.
- US9 shell states and view modes: the search filter is a pure
  `filterPublications` in `lib/filter.ts` with a `bun test` unit spec, the
  grid and list toggle pressed state and the host theme flip between
  `berlinNight` and `berlinDay` are covered in `tests/app-start.spec.ts`, and
  the list layout class plus the no match echo joined the owner fixture test
  because the grid only renders behind a connected identity. Unit tests are
  excluded from tsc and eslint the same way as in the store app.
- US3 card grid parity: each card now loads its own records through the shared
  `useProjectRecords` hook and renders the manifest icon or letter fallback via
  the shared `ProductAvatar`, the manifest display name, the `.dot.li` link, a
  meta line with the publisher short hex and the published date carried through
  `listMyPublished`, and a reserved empty sparkline slot. The card content
  assertions live in the env gated owner fixture test in `tests/domains.spec.ts`
  because rendering cards needs an owning account. The empty state stays
  covered by `tests/app-start.spec.ts`.
- US6 domains tab: `readModalityContenthashes` in `lib/records.ts` reads the
  `app.`, `widget.`, and `worker.` subname contenthashes in one multicall. The
  Domains tab lists the root record, the three modality rows with a live CID
  or an explicit No content state, and the `.dot.li` gateway row with an Open
  link, in the captured Vercel row anatomy. Switching projects now resets the
  detail view to Overview. Covered in `tests/detail.spec.ts` against `browse`,
  whose app and widget subnames are live and whose worker subname is empty.
- US5 overview hero card: the Overview tab is a Production Deployment card
  with a live status dot, publisher and published date from `publicationStatus`
  in `lib/publisher.ts`, the content CID, a Visit link, and a disabled Rollback
  slot for US10. A failed chain read shows an inline error, proven with a
  no-networks host (`startBareHost`). The e2e also exposed and fixed a bug
  where a network failure read as Not published because `publicationOn`
  swallowed errors. Covered in `tests/detail.spec.ts`.
- US2 records read module and detail header: `lib/records.ts` reads manifest,
  legacy name and description, and contenthash in one multicall; `lib/icon.ts`
  resolves icons through the host preimage bridge. The detail header shows the
  live manifest name and description with a loading skeleton, the icon or the
  letter fallback, and falls back to `<label>.dot` when no records exist.
  Covered by `tests/detail.spec.ts` against `browse` on paseo-next-v2. The e2e
  suite moved to its own default port 5273 so a dev server on 5173 is never
  silently reused.

## Now

Every story in USER-STORIES.md is Done. What remains lives in Gaps below and
is gated on infrastructure outside this app.

## Gaps / Needs-infra

- Tier B happy paths (publish, unpublish, record edits, revert, the
  permission gate paths, and the funding timeout fall through) need a
  paseo-next-v2 account that owns a username with personhood and funds. Specs
  gate on `E2E_OWNER_MNEMONIC` and `E2E_OWNER_USERNAME` and skip when absent.
  Provisioning that fixture is open work outside this app.
- host-api-test-sdk 0.10 `setLoginBehavior` does not gate the product-sdk
  0.19 `requestLogin`, so the login declined message cannot be staged in the
  mock host. Upstream gap to report against the test sdk.
- Per-domain analytics has no data source, so the Analytics tab stays an
  honest enable panel (US11).
- Card and header icon specs assert the fallback path only, because the mock
  host serves only seeded preimages. The provable icon round trip is the US7
  upload preview.
- `listMyPublished` truncates at 500 scanned labelhashes, a product limit.
- Publisher lite tier: one publish per rolling day in code, three in the docs.
  Docs correction is a separate change in the main browse repo.
