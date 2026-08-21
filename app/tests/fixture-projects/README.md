# E2E fixture projects

The standalone apps the e2e suite expects to find deployed on the network. They
are versioned here so a network reset never depends on a local checkout, or on a
repo this one does not own, to rebuild the fixture world.

Each project is a self-contained Vite app, deliberately outside the bun
workspace and excluded from the app typecheck sweep. Its
`bulletin-deploy.config.ts` pins the domain and display name the tests assert
on, so deploy from the project directory without overriding either:

```bash
cd calculator   # or stopwatch, alarm, countdown
bun install
bun run build
bulletin-deploy dist calculator.test --env preview --publish
```

`calculator` and `stopwatch` are **published**, so they appear in the All tab.

`alarm` and `countdown` are deployed **without** `--publish`, on purpose. They
have a content record and a display name to render, and are absent from every
tab, which is the only way to exercise the debounced live resolution behind the
search bar. Publishing either one silently guts the tests that search for it:
the card then comes from the All list and the resolution path is never hit.

Base names are 9 characters or more because DotNS gates shorter ones. Names of 5
characters or fewer are reserved for governance, and 6 to 8 require the signer to
hold ProofOfPersonhoodFull, which a fixture deploy should not depend on.

The suite also expects `browse-beta00.test` and `host-playground.test`
published. Those deploy from their own repos.
