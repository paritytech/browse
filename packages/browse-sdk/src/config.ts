// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 	http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { NetworkAddresses } from "./types.js";

export interface NetworkConfig extends NetworkAddresses {
  // Dotns
  STORE_FACTORY: `0x${string}`;
  REGISTRY: `0x${string}`;
  // Attestation Protocol
  SCHEMA_REGISTRY: `0x${string}`;
  ATTESTATION_SERVICE: `0x${string}`;
  ATTESTATION_INDEX_RESOLVER: `0x${string}`;
  TRUSTED_ATTESTER_RESOLVER: `0x${string}`;
  IPFS_GATEWAY: string;
  SCHEMA_ID: bigint;
  CERT_SCHEMA_ID: bigint;
  rpcs: readonly string[];
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const PASEO_ASSET_HUB_NEXT_V2_GENESIS =
  "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f" as const;

export const PREVIEWNET_ASSET_HUB_GENESIS =
  "0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb" as const;

export const SUMMIT_ASSET_HUB_GENESIS =
  "0xf388dc6d6cdf6fb77eac3c4a91f31bc0c8642b142f1a757512ab7849f9f70660" as const;

export const KNOWN_NETWORKS = {
  [PASEO_ASSET_HUB_NEXT_V2_GENESIS]: {
    MULTICALL3: "0xFc430CcCdb9335C1907fc72e93eb1f48e847319C",
    STORE_FACTORY: "0x692047C1477a017F287488E1c85F96Ca28C23fD8",
    CONTENT_RESOLVER: "0x8A26480b0B5Df3d4D9b95adc24a5Ecb33A5b8F64",
    REGISTRY: "0xa1b2b939E82b2ecE55Bd8a0E283818BfC1CA6CDc",
    REGISTRAR: "0xf7Ad3F44F316C73E4a2b46b1ed48d376bCc9E639",
    PUBLISHER: [
      {
        version: "2.1.0",
        address: "0x0d30645f1d2c7dfa11926190e456a45db440581f",
      },
      {
        version: "2.0.0",
        address: "0xa616254fd98724c7a3d295c98ca393a486096b68",
      },
    ],
    SCHEMA_REGISTRY: "0xbe92a66b697dc9bd4a35b1b8e3aead484d2010a7",
    ATTESTATION_SERVICE: "0x24af868f14605460f6385aae166986cee9800514",
    ATTESTATION_INDEX_RESOLVER: "0x5d701a1aca551b0e1cd6a00172554e5ff2348104",
    TRUSTED_ATTESTER_RESOLVER: "0x5abfc89934ee846d12629dfb5b22eecc59bbaed3",
    IPFS_GATEWAY: "https://paseo-bulletin-next-ipfs.polkadot.io",
    SCHEMA_ID: 1n,
    CERT_SCHEMA_ID: 2n,
    rpcs: ["wss://paseo-asset-hub-next-rpc.polkadot.io"],
  },
  [PREVIEWNET_ASSET_HUB_GENESIS]: {
    MULTICALL3: "0x758F88C7761FCD4742f9471448c2209a7e859280",
    STORE_FACTORY: "0x4BEFaB5de968183524b1eBd2FAec9C68Cdc696Fd",
    CONTENT_RESOLVER: "0xBD003d5Dd04E68aC60d529a46AEfBdEf8941868C",
    REGISTRY: "0x5622CA75C75726Da13ae46C69127C07c87538633",
    REGISTRAR: "0x061273AeF34e8ab9Ca08E199d7440E2639Fc2088",
    PUBLISHER: [
      {
        version: "2.1.0",
        address: "0xcea6551761b9ea035b1f2be5cddd9dd85148437d",
      },
      {
        version: "2.0.0",
        address: "0xa616254fd98724c7a3d295c98ca393a486096b68",
      },
    ],
    SCHEMA_REGISTRY: "0xbe92a66b697dc9bd4a35b1b8e3aead484d2010a7",
    ATTESTATION_SERVICE: "0x24af868f14605460f6385aae166986cee9800514",
    ATTESTATION_INDEX_RESOLVER: "0x5d701a1aca551b0e1cd6a00172554e5ff2348104",
    TRUSTED_ATTESTER_RESOLVER: "0xdc713ebf1028544a00225c8741eb698253c49302",
    IPFS_GATEWAY: "https://previewnet.substrate.dev",
    SCHEMA_ID: 1n,
    CERT_SCHEMA_ID: 2n,
    rpcs: ["wss://previewnet.substrate.dev/asset-hub"],
  },
  [SUMMIT_ASSET_HUB_GENESIS]: {
    MULTICALL3: "0x1C1044BEa5bDe0F435436bB52A8340fBE1D59847",
    STORE_FACTORY: "0x2947af3CBFb45b89610524a25921C32cB65C4C39",
    CONTENT_RESOLVER: "0xf110e5799c3f0adb8ED885C02c45Ecfe7fD86226",
    REGISTRY: "0xFb7AB7E142ED0248D77198CA8722D67C1930D783",
    REGISTRAR: "0xf3969bCBE60463302306663C62A6A8ef91ab9aA5",
    PUBLISHER: [],
    SCHEMA_REGISTRY: ZERO_ADDRESS,
    ATTESTATION_SERVICE: ZERO_ADDRESS,
    ATTESTATION_INDEX_RESOLVER: ZERO_ADDRESS,
    TRUSTED_ATTESTER_RESOLVER: ZERO_ADDRESS,
    IPFS_GATEWAY: "https://summit-bulletin-rpc.polkadot.io",
    SCHEMA_ID: 1n,
    CERT_SCHEMA_ID: 0n,
    rpcs: ["wss://summit-asset-hub-rpc.polkadot.io"],
  },
} as const satisfies Record<string, NetworkConfig>;

export type NetworkGenesis = keyof typeof KNOWN_NETWORKS;

export function isKnownGenesis(genesis: string): genesis is NetworkGenesis {
  return Object.prototype.hasOwnProperty.call(KNOWN_NETWORKS, genesis);
}

export function selectNetwork(genesis: NetworkGenesis): NetworkConfig {
  return KNOWN_NETWORKS[genesis];
}

/**
 * Every Publisher address to read listings from, current first.
 *
 * Reads union across all deployments so a redeploy doesn't strand the listings
 * published to an older registry. Empty on networks without a Publisher.
 */
export function publisherReadAddresses(
  network: NetworkConfig,
): `0x${string}`[] {
  return network.PUBLISHER.map((deployment) => deployment.address);
}
