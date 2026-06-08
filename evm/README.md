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
and gates who can publish with proof-of-personhood and per-account rate limits. Attestations on
products are indexed by resolvers bound to an attestation service.
[RecipientAndAttesterIndexResolver.sol](src/RecipientAndAttesterIndexResolver.sol) groups attestation
IDs by recipient, schema, and attester so the app can query them efficiently.
[TrustedAttesterIndexResolver.sol](src/TrustedAttesterIndexResolver.sol) handles certification schemas
that may only be granted by one trusted attester. It admits that attester alone and indexes the
certified recipients by schema.

## Deployments

The addresses below are the source of truth the SDK and app
read, defined in [packages/browse-sdk/src/config.ts](../packages/browse-sdk/src/config.ts). Full
deployment records live in [deployments.json](deployments.json).

### Testnets

#### Paseo Next Asset Hub V2

Genesis `0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f`.

Version 2.1.0:

* **Publisher**:
  * Contract: `0x0d30645f1d2c7dfa11926190e456a45db440581f`
  * Deployment and ABI: [Publisher.sol](src/Publisher.sol)
* **RecipientAndAttesterIndexResolver**:
  * Contract: `0x5d701a1aca551b0e1cd6a00172554e5ff2348104`
  * Deployment and ABI: [RecipientAndAttesterIndexResolver.sol](src/RecipientAndAttesterIndexResolver.sol)
* **TrustedAttesterIndexResolver**:
  * Contract: `0x5abfc89934ee846d12629dfb5b22eecc59bbaed3`
  * Trusted attester: `0x35Cdb23fF7fc86E8DCcd577CA309bFEA9c978D20`
  * Deployment and ABI: [TrustedAttesterIndexResolver.sol](src/TrustedAttesterIndexResolver.sol)

#### Previewnet Asset Hub

Genesis `0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb`.

Version 2.1.0:

* **Publisher**:
  * Contract: `0xcea6551761b9ea035b1f2be5cddd9dd85148437d`
  * Deployment and ABI: [Publisher.sol](src/Publisher.sol)
* **RecipientAndAttesterIndexResolver**:
  * Contract: `0x5d701a1aca551b0e1cd6a00172554e5ff2348104`
  * Deployment and ABI: [RecipientAndAttesterIndexResolver.sol](src/RecipientAndAttesterIndexResolver.sol)
* **TrustedAttesterIndexResolver**:
  * Contract: `0xdc713ebf1028544a00225c8741eb698253c49302`
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
npm run deploy:trusted-resolver   # deploy the trusted-attester (certification) resolver
npm run register:schema           # register a schema (SCHEMA required, RESOLVER overridable)
```

## Happy browsing!