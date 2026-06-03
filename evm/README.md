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

## Dependencies

These contracts are not part of browse. The SDK, app, and deploy scripts reference them at the
addresses below, also defined in
[packages/browse-sdk/src/config.ts](../packages/browse-sdk/src/config.ts).

### Multicall3

The canonical batched-read aggregator. The SDK uses it to hydrate listings in one round trip.

* Paseo Next Asset Hub V2: `0xFc430CcCdb9335C1907fc72e93eb1f48e847319C`
* Previewnet Asset Hub: `0x758F88C7761FCD4742f9471448c2209a7e859280`

### Attestation service

The resolver binds to an AttestationService, and `make register-schema` targets a SchemaRegistry.
Both come from the attestation protocol and are shared across these networks.

* AttestationService: `0x24af868f14605460f6385aae166986cee9800514`
* SchemaRegistry: `0xbe92a66b697dc9bd4a35b1b8e3aead484d2010a7`

## Testing

Install [Foundry](https://paritytech.github.io/foundry-book-polkadot/) and the script dependencies,
then run the tests.

```sh
make install
forge test -vv
```

## Deploy

Run `make install` once, then copy [.env.example](.env.example) to `.env` and set `MNEMONIC` and
`GENESIS_HASH`. The commands below run from [`scripts/`](scripts) and load `.env` automatically.

```sh
cd scripts
npm run deploy-publisher                            # deploy the publishing registry
ATTESTATION_SERVICE=0x... npm run deploy-resolver   # deploy the attestation index resolver
SCHEMA="bool like" npm run register-schema          # register a schema (optional RESOLVER=0x...)
npm run publish-app -- <label>                      # publish a label to the registry
```

`GENESIS_HASH` selects the target network, defined in [scripts/network.ts](scripts/network.ts).
`MNEMONIC` provides the deployer key, with `DERIVATION_PATH` as an optional HD path. Both default to
the `//Alice` dev account when unset.

`GENESIS_HASH` selects the target network, defined in [scripts/network.ts](scripts/network.ts).
`MNEMONIC` provides the deployer key, with `DERIVATION_PATH` as an optional HD path. Both default to
the `//Alice` dev account when unset.

## Happy browsing!