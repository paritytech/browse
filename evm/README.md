<div align="center">

# Home for privacy apps

<!-- markdownlint-disable-next-line MD013 -->
![CI](https://github.com/paritytech/browse/actions/workflows/build.yml/badge.svg)

<br>

> Find apps on privacy platforms. Save what you love. Recommend the best.

</div>

# Overview

The backend layer behind browse.dot. A publishing registry where anyone can publish a product, and any client can read the published set back.

Labels are published through [Publisher.sol](src/Publisher.sol), which records each published label
and gates who can publish with proof-of-personhood and per-account rate limits. Attestations on
products are indexed by [RecipientAndAttesterIndexResolver.sol](src/RecipientAndAttesterIndexResolver.sol),
a resolver bound to an attestation service that groups attestation IDs by recipient, schema, and
attester so the app can query them efficiently.

## Deployments

The addresses below are the source of truth the SDK and app
read, defined in [packages/browse-sdk/src/config.ts](../packages/browse-sdk/src/config.ts). Full
deployment records live in [deployments.json](deployments.json).

### Testnets

#### Paseo Next Asset Hub V2

Genesis `0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f`.

Version 2.0.0:

* **Publisher**:
  * Contract: `0xa616254fd98724c7a3d295c98ca393a486096b68`
  * Deployment and ABI: [Publisher.sol](src/Publisher.sol)
* **RecipientAndAttesterIndexResolver**:
  * Contract: `0x5d701a1aca551b0e1cd6a00172554e5ff2348104`
  * Deployment and ABI: [RecipientAndAttesterIndexResolver.sol](src/RecipientAndAttesterIndexResolver.sol)

#### Previewnet Asset Hub

Genesis `0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb`.

Version 2.0.0:

* **Publisher**:
  * Contract: `0xa616254fd98724c7a3d295c98ca393a486096b68`
  * Deployment and ABI: [Publisher.sol](src/Publisher.sol)
* **RecipientAndAttesterIndexResolver**:
  * Contract: `0x5d701a1aca551b0e1cd6a00172554e5ff2348104`
  * Deployment and ABI: [RecipientAndAttesterIndexResolver.sol](src/RecipientAndAttesterIndexResolver.sol)

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


```sh
npm run deploy:publisher   # deploy the publishing registry
npm run deploy:resolver    # deploy the attestation index resolver
npm run register:schema    # register browse's attestation schema
```

## Happy browsing!