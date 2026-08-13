> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

<div align="center">

# Home for privacy apps

<!-- markdownlint-disable-next-line MD013 -->
![CI](https://github.com/paritytech/browse/actions/workflows/build.yml/badge.svg)

<br>

> Find apps on privacy platforms. Save what you love. Recommend the best.

</div>

# Overview

The backend layer behind Browse. A publishing registry where anyone can publish a product, and any client can read the published set back.

Labels are published through [Publisher.sol](src/Publisher.sol), which records each published label
and gates who can publish. A publisher submits a ring-membership proof of personhood over
`getPublishDigest(publisher, labelhash)`, which covers the chain, the registry, the publisher, and the
label, so a proof is spendable once for one name. The daily rate limit is counted per person rather
than per address. Attestations on products are indexed by resolvers bound to an attestation service.
[RecipientAndAttesterIndexResolver.sol](src/RecipientAndAttesterIndexResolver.sol) groups attestation
IDs by recipient, schema, and attester so the app can query them efficiently. It also gates new
attestations on a bound identity: a product account first proves, once, that an identity authorized
it (an sr25519 signature checked against the System precompile via `bindIdentity`), and the resolver
then admits an attestation only when that identity has not already attested the same recipient and
schema, giving one-identity-one-recommendation. It does not check personhood.
[TrustedAttesterIndexResolver.sol](src/TrustedAttesterIndexResolver.sol) handles certification schemas
that may only be granted by one trusted attester. It admits that attester alone and indexes the
certified recipients by schema.

## Deployments

The addresses below are the source of truth the SDK and app
read, defined in [packages/browse-sdk/src/config.ts](../packages/browse-sdk/src/config.ts). Full
deployment records live in [deployments.json](deployments.json).

### Testnets

#### Paseo AssetHubNextV2

Genesis `0x23e730eb1c6fecae09c917439a5038cb6122d0d48980e8b9bbf0ff56f94a2ca6`.

TLD `.paseo`.

Publisher 3.0.0:

* **Publisher**:
  * Contract: `0x34890368dFc109C0b905EA96035A850E3e5C3a2f`
  * Deployment and ABI: [Publisher.sol](src/Publisher.sol)
  * Second in the SDK `PUBLISHER` array. Reads union every entry, writes go to the first, and this
    one starts empty while 2.2.0 still holds the published set.

Version 2.2.0:

* **Publisher**:
  * Contract: `0x1875B90A61705917945f9B7C6Ff7819Ad48A198e`
  * Deployment and ABI: [Publisher.sol](src/Publisher.sol)
* **RecipientAndAttesterIndexResolver**:
  * Contract: `0xAca17c2547f09b3AD0d3bd28Db11EE172604b85b`
  * Deployment and ABI: [RecipientAndAttesterIndexResolver.sol](src/RecipientAndAttesterIndexResolver.sol)
* **TrustedAttesterIndexResolver**:
  * Contract: `0x8326c11a76Dda4702046e92f73C0ea7E698560a2`
  * Trusted attester: `0x35Cdb23fF7fc86E8DCcd577CA309bFEA9c978D20`
  * Deployment and ABI: [TrustedAttesterIndexResolver.sol](src/TrustedAttesterIndexResolver.sol)

#### Previewnet AssetHub

Genesis `0x4d11c803cc6921429e3876638977ad006ea1bba8cd3976a0bca2f164e7026210`.

TLD `.dot`.

Publisher 3.0.0:

* **Publisher**:
  * Contract: `0x34890368dFc109C0b905EA96035A850E3e5C3a2f`
  * Deployment and ABI: [Publisher.sol](src/Publisher.sol)
  * Second in the SDK `PUBLISHER` array. Reads union every entry, writes go to the first, and this
    one starts empty while 2.1.0 still holds the published set.

Version 2.1.0:

* **Publisher**:
  * Contract: `0x5a3c111278ec98f327466c9ab7a5e0e0f5047acc`
  * Deployment and ABI: [Publisher.sol](src/Publisher.sol)
* **RecipientAndAttesterIndexResolver**:
  * Contract: `0x1563d8f5beab796529d1135d1600a3e75476a1da`
  * Deployment and ABI: [RecipientAndAttesterIndexResolver.sol](src/RecipientAndAttesterIndexResolver.sol)
* **TrustedAttesterIndexResolver**:
  * Contract: `0x956834cd15bf02d3d9bb427e86d7115f5b062927`
  * Trusted attester: `0x35Cdb23fF7fc86E8DCcd577CA309bFEA9c978D20`
  * Deployment and ABI: [TrustedAttesterIndexResolver.sol](src/TrustedAttesterIndexResolver.sol)

## Testing

Install [Foundry](https://paritytech.github.io/foundry-book-polkadot/) and the script dependencies,
then run the tests.

```sh
make install
forge test -vv
```

## Deploy

Install dependencies

```sh
make install
```


For a full deployment use the repo-root `npm run deploy`, which stages these in order
and skips whatever is already in the SDK config. The individual steps are:

```sh
npm run deploy:publisher          # deploy the publishing registry
npm run deploy:resolver           # deploy the attestation index resolver
npm run deploy:trusted-resolver   # deploy the certification resolver
npm run register:schema           # register a schema
```

## Happy browsing!