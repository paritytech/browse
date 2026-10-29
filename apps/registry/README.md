> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

<div align="center">

# Home for privacy apps.

<!-- markdownlint-disable-next-line MD013 -->

![CI](https://github.com/paritytech/browse/actions/workflows/build.yml/badge.svg)

<br>

> Find apps on privacy platforms. Save what you love. Recommend the best.

</div>

# Overview

Browse is published in 2 modalities:

- **Single-page Application (SPA)** is the full standalone app.
- **widget** is a compact, embeddable build you can place inside another app. Its source lives in `apps/widget` and builds into `dist/widget` here.

## Compatibility

| Tool    | Version  |
| ------- | -------- |
| Bun     | ~1.3.10  |
| Node.js | ~22.13.1 |

## Develop

```sh
bun install
bun dev                 # default network
```

### PGAS payments

Contract writes use transaction extension pipeline 1 on Paseo Next V2 and Previewnet.

Host-backed transaction creators select it with `{ txExtVersion: 1 }`. Pipeline 0
does not charge PGAS, even when the account has a funded allowance. The registry
and portal select pipeline 1 when creating their transaction signers.

Recommendation fixtures fund the product account with PGAS only. The first
recommendation test checks that its native balance remains zero before and after
the write, so native funding cannot hide a payment-pipeline regression.

```sh
bun run test:e2e:paseo
bun run test:e2e:previewnet
```

## Deploy

Install deployment CLI.

```sh
npm install -g bulletin-deploy
```

Build both modalities, the Single-page Application (SPA) and the widget.

```sh
make build
```

Deploy both modalities to Polakdot. They are deployed together via the manifest. `MNEMONIC` is
read from the repository root `.env`.

```sh
make deploy
```

## Happy browsing!
