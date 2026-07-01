> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

<div align="center">

# Home for privacy apps

<!-- markdownlint-disable-next-line MD013 -->
![CI](https://github.com/paritytech/browse/actions/workflows/build.yml/badge.svg)
<!-- markdownlint-disable-next-line MD013 -->
![Tests](https://github.com/paritytech/browse/actions/workflows/e2e.yml/badge.svg)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](./LICENSE)
[![Polkadot](https://img.shields.io/badge/polkadot-ecosystem-E6007A?style=flat-square&logo=polkadot)](https://polkadot.com)

<br>

> Find apps on privacy platforms. Save what you love. Recommend the best.

</div>

This repository hosts the source for its 3 components.

| 📦 Component | 📄 Description |
|-------------|-----------------|
| **[Client artifacts](app/)** | Includes 2 prototype modalities: a single-page application (SPA) and an embeddable widget. |
| **[Smart contracts](evm/)** | Deploy a publishing registry and its supporting contracts. |
| **[`browse-sdk`](packages/browse-sdk/)** | A Node.js package that lets third-party components easily access browse functionality. |

## Deploy

Set variables in `.env` (copy it from [.env.example](.env.example)), then run

Using npm

```sh
npm run deploy
```

Using yarn

```sh
yarn deploy
```

Using pnpm

```sh
pnpm run deploy
```

Using bun

```sh
bun run deploy
```

See [docs/one-deployment.md](docs/one-deployment.md) for more details.

## Licence

The application in this repository is licensed under **GPL-3.0**. See [LICENSE](LICENSE).

`@parity/browse-sdk` is licensed under **Apache-2.0** so downstream consumers
can adopt it freely. See its [package manifest](packages/browse-sdk/package.json).

## Security

This is reference and proof-of-concept code. It has not been independently audited. Please follow
the [Parity security policy](https://github.com/paritytech/.github/blob/main/SECURITY.md) for reporting vulnerabilities.

## Happy browsing!
