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

| Tool | Version |
|------|---------|
| Bun | ~1.3.10 |
| Node.js | ~22.13.1 |

## Develop

```sh
bun install
bun dev                 # default network
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

Publish both modalities to the bulletin chain and list browse.dot in the Publisher registry. They
ship together via the manifest. `MNEMONIC` is read from the repository root `.env`.

```sh
make deploy
```

## Happy browsing!
