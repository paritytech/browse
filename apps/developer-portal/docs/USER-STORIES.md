# Developer portal user stories

The tested flow catalog for the drive to Vercel parity. Each story carries its
acceptance criteria, its testability tier, and the spec file that proves it.
PORTAL-BACKLOG.md tracks execution state against this catalog.

The visual reference is a set of screens captured from a real Vercel account on
2026-08-01: the projects grid, a project overview, the deployments list and its
row menu, the domains page, the analytics enable panel, and project settings.
Layouts follow those captures but are executed with the design tokens in
`src/styles/tokens.css`. Where a capture leaves a question open, the story says
approximate rather than presenting an invention as faithful.

## Tiers

- **A**: fully provable end to end in the mock host, including live chain reads
  through the test host proxy.
- **B**: the UI and error path are provable now. The happy path needs the
  fixture account described in the backlog Gaps and is gated on
  `E2E_OWNER_MNEMONIC` and `E2E_OWNER_USERNAME`. Specs skip, never fake, when
  the env is absent.

The e2e network is paseo-next-v2 for now. Previewnet comes later.

## US1: Add a domain

A developer adds a `.dot` domain they own and gets a decoded reason when they
cannot.

- Given the add page and a seeded snapshot preimage, when the user types at
  least two characters, then matching `.dot` suggestions render.
- Given a suggestion, when clicked, then the input holds the bare label and the
  list closes.
- Given a signed host as alice, when she submits `browse`, then the decoded
  ownership error renders before anything is signed and the signing log stays
  empty.
- Given the input `MyApp.DOT `, when submitted, then the flow uses the
  normalized label `myapp`.
- Given the fixture account and a label it owns, when submitted, then the card
  appears in the grid. Tier B.

Tier: B overall, suggestions and error path A. Spec: `tests/domains.spec.ts`.
Notes: the add-domain error test moves out of `app-start.spec.ts`. Suggestions
need `APP_DOMAINS_SNAPSHOT_CID` pinned to the CID of the seeded manifest bytes.

## US2: Live records on the detail header

A developer sees the real name, description, and icon of a project instead of
placeholders.

- Given `/d/<label>` for a published label, when records load, then the header
  shows the manifest display name and description, with a skeleton while
  loading.
- Given an icon whose preimage the host cannot resolve, when the lookup fails,
  then the letter avatar fallback renders.
- Given a label with no manifest, when records load, then the header falls back
  to `<label>.dot` with no description.

Tier: A. Spec: `tests/detail.spec.ts`.
Notes: new `lib/records.ts` read half, reading `text(node, "manifest")`,
`text(node, "name")`, `text(node, "description")`, and `contenthash(node)`
against `NETWORK.CONTENT_RESOLVER`, ABI mirrored from
`packages/browse-sdk/src/abi/contracts.ts`. New `lib/icon.ts` ported from
`app/src/state/apps/icon.ts`. This story unblocks US3, US5, US6, US7, and US10.

## US3: Product card parity

A developer scans the grid and recognizes projects the way the Vercel projects
grid reads.

- Given a rendered card, when its manifest resolves, then it shows the icon or
  letter fallback, the display name, the `<label>.dot.li` link, and a meta line
  with the publisher short hex and the published date.
- Given no metrics source, when the card renders, then the sparkline slot stays
  reserved and empty rather than showing invented activity.
- Given no owned publications, when the grid loads, then the existing empty
  state renders unchanged.

Tier: B for owned cards, A for the states. Spec: card states in
`tests/domains.spec.ts`, shared subcomponents proven on the detail header in
`tests/detail.spec.ts`.
Notes: carry `publicationOf.timestamp` through `listMyPublished` consumers.

## US4: Publish and unpublish from the detail page

A developer manages a project lifecycle from the project page, not only from
the card menu.

- Given the Settings tab of a published label, when the danger card renders,
  then unpublish requires an explicit two step confirm, mirroring the card
  menu.
- Given alice on `/d/browse`, when she confirms unpublish, then the dry run
  surfaces the ownership error and nothing is signed.
- Given the fixture account on a label it owns, when publish or unpublish is
  confirmed, then the lifecycle completes and the status updates. Tier B.

Tier: B, error path A. Spec: `tests/detail.spec.ts`.
Notes: reuse `submitPublish`. The danger card is the last settings card, red
action, following the captured Delete Project card.

## US5: Overview hero card

A developer sees live production status at a glance, like the captured
Production Deployment card.

- Given `/d/<label>` for a published label, when the overview loads, then the
  hero shows a Ready status dot, the publisher address and published date from
  the registry, the current contenthash CID, and a Visit link whose href is
  `https://<label>.dot.li`. Tests assert the href and never fetch it.
- Given a label that is not published, when the overview loads, then the status
  reads Not published and the records that do exist still render.
- Given a failed chain read, when the overview renders, then an inline error
  state shows instead of a blank section.

Tier: A. Spec: `tests/detail.spec.ts`.
Notes: extend `publicationOn` in `lib/publisher.ts` to return the timestamp it
currently discards. The hero Rollback slot is wired in US10.

## US6: Domains tab with resolved addresses

A developer sees every address that resolves to the product, including the
modality subnames.

- Given `/d/<label>`, when the Domains tab opens, then it lists the root
  `<label>.dot` with its CID, the `app.`, `widget.`, and `worker.` subnames
  with a live CID or an explicit No content state, and the `<label>.dot.li`
  gateway row.
- Given a subname without content, when listed, then it shows No content, not
  an error.

Tier: A. Spec: `tests/detail.spec.ts`.
Notes: row anatomy follows the captured domains page: status icon, name over a
status line, environment tag, trailing action. Modality node convention is
`namehash("<modality>.<label>.dot")` as in `listAppsByModality` in
`packages/browse-sdk/src/sdk.ts`.

## US7: Settings edits through dotNS records

A developer edits the name, description, and icon, and every change is gated by
a dry run before signing.

- Given the Settings tab, when it loads, then stacked cards render title,
  description, one control, and a Save footer each, prefilled from the current
  records.
- Given an edited name saved by an account that lacks authority, when the dry
  run reverts, then the decoded error shows in the card footer and the signing
  log stays empty.
- Given a selected icon file, when it is read, then a local preview renders,
  the computed CID is CIDv1 raw blake2b-256, and the preimage submit and lookup
  round trip resolves in the host.
- Given the fixture account, when a save passes the dry run, then the manifest
  record is rewritten in the `$v: 1` shape and the legacy `name` and
  `description` text records are updated for the legacy client. Tier B.

Tier: B, with the icon preview round trip and the revert path A. Spec:
`tests/detail.spec.ts`.
Notes: write half of `lib/records.ts` using `setText` and `setContenthash`.
Extract the shared dry run, allowance, permission, and submit pipeline out of
`submitPublish` into `submitReviveCall` and reuse it for record writes. Append
successful edits to `lib/history.ts` with source `edit`.

## US8: Rejection paths

A developer always gets an actionable message when the host declines a step.

- Given login behavior set to reject, when a publish is submitted, then a
  connection declined message renders and no chain write happens.
- Given a dry run that reverts, when the flow stops, then the permission log
  shows no submit permission was ever requested.
- Given permission behavior set to reject with the fixture account, when a
  submit reaches the permission gate, then a permission denied message renders.
  Tier B.
- Given the funding timeout env pinned low, when an allowance never funds, then
  the flow falls through within the test budget instead of hanging.

Tier: A for the unauthenticated add failing before anything signs and for the
permission log staying empty on a failed add. The login reject message cannot
be staged because `setLoginBehavior` in host-api-test-sdk 0.10 does not gate
the product-sdk 0.19 `requestLogin`, an upstream gap. The permission denied
message, the dry run before permission ordering, and the funding timeout fall
through all sit behind a resolvable identity, which the mock host cannot
mint, so they are tier B. A probe of every paseo username found none owning a
published label, so no free identity exists for the gate. Spec: folded into
`tests/domains.spec.ts`.

## US9: Shell states and view modes

A developer gets a coherent shell in both themes and all data states.

- Given the grid, when the list toggle is clicked, then the toggle reports
  pressed and the products container switches to the list layout.
- Given a query with no matches, when typed, then the empty state echoes the
  query.
- Given the host pushes dark then light, when the theme flips, then the product
  frame `html[data-theme]` switches between `berlinNight` and `berlinDay`.
- Given a connected identity before the list resolves, when skeletons show,
  then three card skeletons render.

Tier: A for the toggle pressed state, the theme flip, and the filter unit
spec. The no match echo, the list layout class, and the skeletons render only
behind a connected identity, so those assertions are tier B in the owner
fixture test. Spec: extend the existing describe in `tests/app-start.spec.ts`,
plus a `bun test` unit spec for a pure `filterPublications` in
`src/lib/filter.test.ts`.

## US10: Deployments history and revert

A developer sees past deployments and rolls production back to a remembered
CID, even though the chain keeps only current state.

- Given a first visit to `/d/<label>`, when the reads resolve, then the current
  CID and the manifest version are recorded as an observed deployment in host
  local storage and the Deployments tab lists one entry.
- Given a later visit after the record changed, or after a portal edit, when
  the list renders, then entries are newest first and the top entry is marked
  Current.
- Given a non current entry, when Rollback is clicked and confirmed, then the
  flow runs identity, a `setContenthash` dry run, and submit like any write.
  For an account without authority the dry run error surfaces and history is
  unchanged.
- Given cleared host storage, when the tab loads, then an honest empty state
  explains history is recorded locally by this portal.
- Given the fixture account, when a rollback submits, then the new entry is
  appended with source `revert`. Tier B.

Tier: A for capture, render, dedupe, the empty state, and the disabled
rollback on the current entry. B for both revert paths, including the
unauthorized error, because a rollbackable second entry only exists after a
successful write and the mock host cannot seed the storage. Spec:
`tests/detail.spec.ts`.
Notes: `lib/history.ts` over the product SDK local storage, key
`portal:deployments:<label>`, entries `{ cid, version, at, source }` with
source one of `observed`, `edit`, `revert`, capped at 20. The manifest has no
version field today, so `version` is the optional `version` field of the raw
manifest JSON when present and the short CID otherwise. Row anatomy follows the
captured deployments list: identifier, status, environment pill with the
current one filled, source badge in the Redeploy-of style for reverts, date,
row menu with Rollback and Visit and with Rollback disabled on the current
entry.

## US11: Analytics enable panel

A developer sees what analytics will offer without being shown fabricated
numbers.

- Given the Analytics tab, when it opens, then the enable panel renders a
  headline, benefit cards, the KPI tab labels Visitors, Page Views, and Bounce
  Rate, and a disabled Enable button with copy stating no metrics source exists
  for `.dot` apps yet.
- Given the panel, when inspected, then no chart, counter, or sparkline shows
  a number, and no demo data renders.

Tier: A. Spec: a describe block in `tests/detail.spec.ts`.

## Known product limits

- `listMyPublished` scans at most 500 labelhashes, so grids and card meta
  silently truncate past that registry size. Product limit, out of scope here.
- The lite publisher tier allows one publish per rolling day in
  `evm/src/Publisher.sol`, while docs/publishing-registry.md says three. The UI
  decodes `RateLimitExceeded` rather than hardcoding a count. The docs need a
  separate correction, and a lite fixture account cannot publish repeatedly in
  CI.
- Manifest icons resolve only through host preimages, so card and header icon
  specs assert the fallback path. The provable icon round trip is the US7
  upload preview.
