# E2E fixture projects

The standalone apps the e2e suite expects to find deployed on the network. They
are versioned here so a network reset never depends on a local checkout, or on a
repo this one does not own, to rebuild the fixture world.

Global setup puts them back: `tests/fixtures/ensure-fixture-apps.ts` deploys
any project whose name has no content, signed by the master wallet, and lists
the published ones in the Publisher as its operator. A healthy network costs one
read per app, so a plain `bun run test:e2e` after a reset rebuilds the world.

Each project is a self-contained Vite app, deliberately outside the bun
workspace and excluded from the app typecheck sweep. Its
`bulletin-deploy.config.ts` pins the domain and display name the tests assert
on, so a manual deploy runs from the project directory without overriding either:

```bash
cd calculator   # or stopwatch, chess-clock, unit-converter, alarm, countdown
bun install
bun run build
bulletin-deploy dist calculator.testnet --env preview
```

`calculator`, `stopwatch`, `chess-clock` and `unit-converter` are **published**,
so they appear in the All tab. Four is a floor, not a coincidence: app-start
asserts `.product-card` at `nth(3)` and a label cache above three entries, and
the refocus test needs a list big enough that the sync dots outlast a 5s poll.
Drop one and three tests fail.

`chess-clock` deploys to previewnet and to paseo, which register the same label
under a different TLD, so it takes its domain from `MANIFEST_DOMAIN`:

```bash
MANIFEST_DOMAIN=chess-clock.paseo bulletin-deploy dist chess-clock.paseo --env paseo-next-v2
```

`alarm` and `countdown` are deployed **without** `--publish`, on purpose. They
have a content record and a display name to render, and are absent from every
tab, which is the only way to exercise the debounced live resolution behind the
search bar. Publishing either one silently guts the tests that search for it:
the card then comes from the All list and the resolution path is never hit.

Base names are 9 characters or more because DotNS gates shorter ones. Names of 5
characters or fewer are reserved for governance, and 6 to 8 require the signer to
hold ProofOfPersonhoodFull, which a fixture deploy should not depend on.

Every project the suite needs lives here. The recommend, motion and share specs
used to point at `host-playground`, which deploys from a repo this one does not
own, so a network rebuild depended on a checkout nobody was guaranteed to have.
They point at `chess-clock` now.
