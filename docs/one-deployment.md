# One-command deployment

Stand up a full browse instance on a network with a single pipeline, instead of manual deploys and hand-edited config.

## Goal

```sh
NETWORK_GENESIS_HASH=0x... MNEMONIC="..." bun run deploy
```

For a target network, this checks the preconditions, deploys the browse-owned contracts, records their addresses, regenerates the client config, builds the app for that network, publishes it, and seeds the directory. Re-running it stays idempotent.

## Overview

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
flowchart TD
    start([Start]):::term

    start -.-> hNet
    hNet[Network Services]:::hdr
    hNet --> d1{Asset Hub<br/>Up?}:::dec
    d1 -->|No| r1[Network support]:::fix
    d1 --> d2{Bulletin<br/>Up?}:::dec
    d2 -->|No| r2[Network support]:::fix

    d2 -.-> hDep
    hDep[Dependency Services]:::hdr
    hDep --> d3{Dotns<br/>deployed?}:::dec
    d3 -->|No| r3[Dotns Support]:::fix
    d3 --> d4{Attestation Protocol<br/>deployed?}:::dec
    d4 -->|No| r4[Attestation Protocol Support]:::fix

    d4 -.-> hAcc
    hAcc[Deployer Account]:::hdr
    hAcc --> d5{Has<br/>personhood?}:::dec
    d5 -->|No| r5[Verify personhood]:::fix
    d5 --> d6{Funded on<br/>Asset Hub?}:::dec
    d6 -->|No| r6[Fund account]:::fix
    d6 --> d7{Funded on<br/>Bulletin?}:::dec
    d7 -->|No| r7[Fund account]:::fix
    d7 --> d8{Owns<br/>browse.dot?}:::dec
    d8 -->|No| r8[Register browse.dot]:::fix

    d8 -.-> hSvc
    hSvc[Browse Services]:::hdr
    hSvc --> p1[↻ Deploy Publisher.sol]:::proc
    p1 --> p2[↻ Deploy<br/>RecipientAndAttesterIndexResolver.sol]:::proc
    p2 --> p3[↻ Register attestation schema]:::proc
    p3 --> p4[Regenerate config]:::proc

    p4 -.-> hClient
    hClient[Browse Client]:::hdr
    hClient --> c1[↻ Deploy Browse SPA and Widget]:::proc

    c1 --> done([End]):::term

    click p1 "https://github.com/paritytech/browse/blob/main/evm/src/Publisher.sol" _blank
    click p2 "https://github.com/paritytech/browse/blob/main/evm/src/RecipientAndAttesterIndexResolver.sol" _blank
    click r3 "https://github.com/paritytech/dotns" _blank
    click r4 "https://github.com/paritytech/attestation-protocol" _blank
    click r6 "https://faucet.polkadot.io/" _blank
    click r7 "https://faucet.polkadot.io/" _blank

    classDef term fill:#D5E8D4,stroke:#82B366,color:#1b3a1b
    classDef hdr fill:none,stroke:none,color:#374151
    classDef dec fill:#FFE6CC,stroke:#D79B00,color:#7a4f00
    classDef fix fill:#F8CECC,stroke:#B85450,color:#7a1f1c
    classDef proc fill:#DAE8FC,stroke:#6C8EBF,color:#1a3a5c
```

## The pipeline

Order matters. Each step depends on the one before. 

1. Check network services. Resolve `NETWORK_GENESIS_HASH` and confirm the programs RPC and storage RPC respond.
2. Check the DotNS contracts. They must be deployed at their addresses in the browse-sdk config, from [paritytech/dotns](https://github.com/paritytech/dotns):

   | Config key | DotNS contract |
   |---|---|
   | `REGISTRAR` | [DotnsRegistrar.sol](https://github.com/paritytech/dotns/blob/master/contracts/registrars/DotnsRegistrar.sol) |
   | `REGISTRY` | [DotnsRegistry.sol](https://github.com/paritytech/dotns/blob/master/contracts/registry/DotnsRegistry.sol) |
   | `CONTENT_RESOLVER` | [DotnsContentResolver.sol](https://github.com/paritytech/dotns/blob/master/contracts/resolvers/DotnsContentResolver.sol) |
   | `STORE_FACTORY` | [StoreFactory.sol](https://github.com/paritytech/dotns/blob/master/contracts/store/StoreFactory.sol) |
   | `MULTICALL3` | [Multicall3.sol](https://github.com/paritytech/dotns/blob/master/contracts/utils/Multicall3.sol) |
   
3. Check the Attestation Protocol contracts. They must be deployed at their addresses in the browse-sdk config, from [paritytech/attestation-protocol](https://github.com/paritytech/attestation-protocol):

   | Config key | Attestation contract |
   |---|---|
   | `SCHEMA_REGISTRY` | [SchemaRegistry.sol](https://github.com/paritytech/attestation-protocol/blob/main/evm/contracts/SchemaRegistry.sol) |
   | `ATTESTATION_SERVICE` | [AttestationService.sol](https://github.com/paritytech/attestation-protocol/blob/main/evm/contracts/AttestationService.sol) |
4. Check the deployer account. Confirm it exists, is funded, and is mapped on the target network.
5. Deploy `Publisher`, passing the registrar from [the browse-sdk config](../packages/browse-sdk/src/config.ts). Write the address to the manifest.
6. Deploy the resolver, passing the AttestationService. Write the address to the manifest.
7. Register the schema in SchemaRegistry. Write the `SCHEMA_ID` to the manifest.
8. Regenerate the SDK config from the manifest.
9. Build the app for the network with `NETWORK_GENESIS_HASH=<genesis> bun run build`.
10. Publish to the Bulletin chain with `bulletin-deploy --publish --env <matching>`. This uploads app and widget to `browse.dot` and lists it in the Publisher registry.
11. Seed the directory with `publish-app` for each starter label.
