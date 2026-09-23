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
- **widget** is a compact, embeddable build you can place inside another app.

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

### Local signing host

`truapi-host dev` starts a signing host on loopback, then runs the dev server with
that host already live, so the app works in a plain browser tab:

```sh
curl -fsSL https://raw.githubusercontent.com/paritytech/host-rust-core/main/scripts/truapi-host-installer.sh | bash

truapi-host dev --network previewnet -- bun run dev:previewnet
```

Open http://localhost:3000. The dev server loads the bridge script the host serves
at `http://127.0.0.1:9955/bootstrap.js`, and builds never include it.
Confirmations are approved automatically, so the host signs whatever the app asks
for. Host and app have to serve the same network.

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
