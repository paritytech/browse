# E2E fixture projects

The standalone apps the e2e suite expects to find deployed on the network:
`calculator.test` and `stopwatch.test`. They are versioned here so a network
reset never depends on a local checkout to rebuild the fixture world.

Each project is a self-contained Vite app, deliberately outside the bun
workspace and excluded from the app typecheck sweep. Its
`bulletin-deploy.config.ts` pins the domain and display name the tests assert
on, so deploy from the project directory without overriding either:

```bash
cd calculator   # or stopwatch
bun install
bun run build
bulletin-deploy dist calculator.test --env preview --publish
```

The suite also expects `browse-beta00.test` and `host-playground.test`
(published) plus `host-playground44.test` and
`browse-trusted-attester-resolver00.test` (registered but unpublished, the
search-only fixtures). Those deploy from their own repos.
