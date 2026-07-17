---
name: deploy
description: This skill should be used when the user asks to "deploy", "deploy to previewnet", "deploy to paseo", "deploy browse-beta00", or "ship the app" from a browse-style repo. It builds the current repo's app for the target network (argument — `previewnet` default, or `paseo`/`paseo-next-v2`) and deploys it to a DotNS domain (default `browse-beta00.dot`) on the matching Bulletin environment, handling the recurring gotchas: Bulletin storage-pool authorization, the local `bulletin-deploy` module symlink, and reclaiming `app.`/`widget.` subnames left owned by a prior deployer.
---

# Deploy a browse-style app

Build the **current git repo's** app for the target network and deploy it to the
DotNS domain. Both come from this skill's arguments (network + optional domain,
default `browse-beta00.dot`). Everything below is the operational runbook — run
the steps in order and adapt to state; stop and report only on a failure not
handled here.

## Parameters

- **Network**: from the arguments — empty / `preview` / `previewnet` →
  previewnet (default); `paseo` / `paseonet` / `paseo-next-v2` → paseo-next-v2;
  anything else, stop and ask. It selects the genesis + bulletin-deploy env:

  | network       | `<GENESIS>` (`NETWORK_GENESIS_HASH`)                                 | `<ENV>` (bulletin-deploy `--env`) |
  | ------------- | -------------------------------------------------------------------- | --------------------------------- |
  | previewnet    | `0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb` | `preview`                         |
  | paseo-next-v2 | `0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f` | `paseo-next-v2`                   |

- **Target domain**: from the arguments if given (e.g. `browse.dot`), otherwise
  `browse-beta00.dot`. Derive the bare **label** by stripping a trailing `.dot`.
- **Build dir**: `dist/spa`. Deploys content + DotNS records only (no
  `--publish`, so the app is not added to the Publisher directory grid).

## Steps

1. **Locate the repo and mnemonic.** `ROOT="$(git rev-parse --show-toplevel)"`.
   Source the signing key from the repo root `.env` (the same one the Makefile
   deploy target uses): `set -a; . "$ROOT/.env"; set +a`. If it yields no
   `MNEMONIC`, stop and ask where the key is. **Never print the mnemonic.**

2. **Ensure `bulletin-deploy` resolves locally.** The app's
   `bulletin-deploy.config.ts` imports `bulletin-deploy`, but the CLI is global.
   If `"$ROOT/app/node_modules/bulletin-deploy"` is missing, symlink it:
   `ln -sfn "$(npm root -g)/bulletin-deploy" "$ROOT/app/node_modules/bulletin-deploy"`.

3. **Authorize the Bulletin storage pool** (idempotent; grants only what's
   expired/missing — `//Alice` is the testnet authorizer):
   `bulletin-bootstrap --env <ENV> --mnemonic "$MNEMONIC"`.

4. **Build for the target network.** Pass the genesis explicitly (the build
   otherwise bakes whatever `.env` defaults to):
   `cd "$ROOT/app" && NETWORK_GENESIS_HASH=<GENESIS> bun run build`.
   Sanity-check that `<GENESIS>` is the active baked genesis in `dist/spa` (it
   should appear more often than any other network hash).

5. **Deploy** (capture full output to a log so nothing is lost):
   `APP_DOTNS_DOMAIN=<label> NODE_OPTIONS="--max-old-space-size=8192" bulletin-deploy dist/spa <label>.dot --env <ENV>`.

6. **If the deploy aborts with `Subname <sub>.<label>.dot is owned by 0x…, not
the publisher`,** the `app.`/`widget.` subnames belong to another account
   (commonly `//Alice` from an earlier deploy). The deployer owns the parent
   `<label>.dot`, so reclaim the subnames and re-run step 5. Run this from
   `"$ROOT/app"` with `LABEL=<label> BD_ENV=<ENV> MNEMONIC="$MNEMONIC"` in the
   environment:

   ```
   node --input-type=module -e '
   import { DotNS, loadEnvironments, resolveEndpoints } from "bulletin-deploy"
   const label = process.env.LABEL, env = process.env.BD_ENV
   const { doc } = await loadEnvironments()
   const ep = resolveEndpoints(doc, env)
   const d = new DotNS()
   await d.connect({ rpc: ep.assetHub[0], assetHubEndpoints: ep.assetHub, contracts: ep.contracts, environmentId: env, autoAccountMapping: ep.autoAccountMapping, mnemonic: process.env.MNEMONIC })
   for (const sub of ["app", "widget"]) {
     const before = await d.checkSubdomainOwnership(sub, label)
     if (!before.owned) { await d.registerSubdomain(sub, label); console.log(sub, "reassigned") }
     else console.log(sub, "already owned by deployer")
   }
   d.disconnect(); process.exit(0)
   '
   ```

7. **Verify.** After a clean deploy (`✓ 3 text records written`), read back the
   contenthashes for `<label>.dot`, `app.<label>.dot`, `widget.<label>.dot` on
   `<ENV>` and confirm root == app and all are the freshly built CIDs. Report the
   live URL bulletin-deploy printed (`https://<label>.dot.li?network=…`).
