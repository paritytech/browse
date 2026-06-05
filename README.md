<div align="center">

# Home for privacy apps

<!-- markdownlint-disable-next-line MD013 -->
![CI](https://github.com/paritytech/browse/actions/workflows/build.yml/badge.svg)

<br>

> Find apps on privacy platforms. Save what you love. Recommend the best.

</div>

This repository hosts the source for its 3 components.

| 📦 Component | 📄 Description |
|-------------|-----------------|
| **[Client artifacts](app/)** | Includes 2 modalities: a single-page application (SPA) and an embeddable widget. |
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

This is reference and proof-of-concept code. It has not been independently audited. Read
[SECURITY.md](SECURITY.md) before any production use.

## Happy browsing!
