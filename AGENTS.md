# Guidance for Coding Agents

Working notes for any coding agent driving this repo (read as `AGENTS.md`, or `CLAUDE.md` which symlinks to it). Skim, don't memorize. The deeper rules link out: CONTRIBUTING.md for doc and test style, `docs/` for design.

## Repo layout

Bun workspace monorepo (`workspaces: ["app", "packages/*"]`, `packageManager: bun@1.3.10`). Root scripts expose only `bun run deploy`.

| Path | Purpose |
|------|---------|
| `app/` | The web client (`@parity/browse-client`). Preact, Vite, TanStack Query, polkadot-api. Builds two targets: SPA and embeddable widget. All client source in `app/src`. |
| `packages/browse-sdk/` | `@parity/browse-sdk`. Network truth: genesis constants, contract addresses, RPCs, and schema IDs per network, in `src/config.ts`. Vite-aliased to its `src`. |
| `evm/` | Solidity (Foundry and Hardhat): the Publisher registry and attestation-index resolvers. Uses its own npm lockfile, not bun. OpenZeppelin is a submodule under `evm/lib/`. |
| `docs/` | Design docs: `one-deployment.md`, `publishing-registry.md`, `ranking-algorithm.md`, `local-storage.md`. |
| `scripts/deploy.ts` | Root deploy pipeline (see the `deploy` skill). |

## Build / test / lint

Web app, run from `app/` (bun):

```bash
bun install                     # workspace install (runs papi generate)
bun run dev                     # SPA dev server (:5173)
bun run dev:previewnet          # SPA on previewnet (:3000)
bun run dev:widget:previewnet   # widget shell
bun run build                   # build:spa then build:widget
bun run typecheck               # tsc --noEmit, strict, must be clean
bun run lint                    # eslint src/
bun run format:check            # prettier check
bun run test:e2e                # Playwright, already sets NETWORK_GENESIS_HASH=previewnet
```

There is no single `verify` script yet. Before calling work done, run `typecheck`, `lint`, and `test:e2e`. A few unit specs exist (`app/src/lib/theme.test.ts`, `packages/browse-sdk/src/manifest.spec.ts`) and run via `bun test`.

Contracts run from `evm/` (forge): `forge build`, `forge test`. Deploy the app with `bun run deploy` at the repo root, or the `deploy` skill.

## Where to look first for X

Paths under `app/src` unless noted.

| You're looking for | Start here |
|---|---|
| App bootstrap / entry | `main.tsx` (SPA) then `App.tsx` (bulk of the UI and feature wiring). Widget entry `widget.tsx` |
| State and sync engine | `state/apps/sync.ts` (`syncAllApps`), `state/apps/remote.ts` (chain reads), `state/apps/queries.ts` (React Query) |
| Client-side cache | `db/*.ts` (`stores`, `labels`, `bookmarks`, `addresses`, `certificate-authorities`), `state/recommendations/cache.ts` |
| Attestations (read/write) | `lib/attestation-service.ts` (`attestationService` singleton). Mutations `state/recommendations/mutations.ts`, queries `state/recommendations/queries.ts` |
| Search | `components/search-bar/`, `filterApps` in `state/apps/types.ts`, driven from `App.tsx` |
| Bookmarks | `db/bookmarks.ts` (key `browse:bookmarks`) |
| Badges / certificate authorities | `components/certificate-*`, `state/certificate-authorities/`, `db/certificate-authorities.ts` |
| Standalone-vs-hosted storage | `lib/local-storage.ts`, the `localStorage` singleton whose `isHosted()` routes to the host bridge |
| Host / product-sdk integration | `lib/client.ts` (SDK singleton, PAPI provider, RPC gating). Identity `lib/identity-binding.ts` |
| Config (genesis, flags) | app `lib/config.ts`. Network truth `packages/browse-sdk/src/config.ts` (`KNOWN_NETWORKS`) |
| EVM contracts | `evm/src/Publisher.sol`, `evm/src/*IndexResolver.sol`, interfaces `evm/src/interfaces/`, addresses `evm/deployments.json` |

## Gotchas

- **Genesis var is `NETWORK_GENESIS_HASH`.** There is no `VITE_ACTIVE_GENESIS`. Vite exposes it via `envPrefix: ['APP_','NETWORK_']` from the root `.env`. Code fallback is Paseo, the committed `.env` pins previewnet, and `.env.example` is Paseo, so mind the mismatch. Only three genesis values are known (paseo-next-v2, previewnet, summit). `dev:*` and `test:e2e` set it inline.
- **Hosted vs standalone.** Never touch `window.localStorage` in feature code. Go through the `localStorage` singleton in `lib/local-storage.ts`, or hosted mode (iframe or `__HOST_WEBVIEW_MARK__`) silently loses data.
- **Dual build** via `APP_BUILD_TARGET` (`spa`, `widget`, or unset for both). The widget build emits `widget.html` then renames it to `index.html`. Two entries: `main.tsx` into `App.tsx`, and `widget.tsx`.
- **Don't hand-edit generated dirs.** `app/.papi/descriptors` (regenerate via `papi generate` or the `papi:*` scripts, source of truth `.papi/polkadot-api.json`) and `app/chain-specs/` (gitignored). Note `.papi/{contracts,metadata,polkadot-api.json}` *are* committed.
- **Versioned contracts.** Publisher and the attestation resolver/schema are arrays in `packages/browse-sdk/src/config.ts`. Reads union all versions, writes use index 0. A redeploy appends, it does not replace.
- **Pinned and patched deps.** Root `overrides` pin `polkadot-api@2.1.4` and `@novasamatech/host-api*@0.8.10`. `@polkadot-api/sdk-ink@0.7.0` is patched (`patches/`). Don't bump casually.
- `lib/client.ts` deliberately drops and rebuilds the SDK on host background and foreground, and rate-gates RPC (about 2.5 per second). Its `debug network connection` logs are intentional instrumentation.
- The `AttestationService` and `SchemaRegistry` contracts live in a separate `paritytech/attestation-protocol` repo. `evm/` here only deploys resolvers against them.

## Skills and agents

Prefer invoking a skill over reimplementing from source:

- `deploy`. Build and deploy to a DotNS domain on Bulletin.
- `contributing`. Audit doc-comments and prose against CONTRIBUTING.md.
- `review-pr`. Read-only PR review.
- `babysit`. Drive an open PR to green.
- `commit-push-pr`. Stage, commit, push, open a PR.

Agents: `code-architect`, `staff-reviewer`, `verify-app`, `code-simplifier`, and the design set (`design-director`, `design-system-steward`, `visual-designer`).

## Conventions

See [CONTRIBUTING.md](CONTRIBUTING.md) for doc-comment and prose style and the bare `// Given` / `// When` / `// Then` E2E marker rule. Commits are GPG-signed with a single-sentence subject. PR bodies are only a `## Summary` of 2 to 5 bullets. Verify (typecheck, lint, e2e) before calling work done.

## Don't touch without good reason

- `app/.papi/descriptors`, `app/chain-specs/` (generated).
- `evm/lib/openzeppelin-contracts` (submodule).
- Root `overrides` and `patchedDependencies` pins.
- `evm/deployments.json` and `.env` (live addresses and secrets).

## Bash command construction (keep commands auto-approvable)

The permission engine matches each sub-command of a Bash call against the allowlist by prefix, and prompts unless **every** sub-command matches. Keep commands plain:

- One command per call. Don't bundle statements with newlines, `&&`, or `;` when separate tool calls work.
- No pipes into a second tool (`… | grep`, `… | jq`). Get the raw output and filter it yourself, or use one tool that does both (e.g. `git grep <ref>` instead of `git show <ref> | grep`).
- No redirections (`2>/dev/null`, `>out.txt`). They force a prompt, so let stderr surface.
- No `cd`. Use absolute paths (the shell already runs in the repo).
- No `export PATH=…` or env-var scaffolding. Tools are already on PATH.
- No `echo` banners. Read files with the Read tool, not `cat`/`head`/`tail`.
