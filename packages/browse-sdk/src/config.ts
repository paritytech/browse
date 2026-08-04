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
  ATTESTATION_INDEX_RESOLVER: readonly `0x${string}`[];
  TRUSTED_ATTESTER_RESOLVER: `0x${string}`;
  TRUSTED_ATTESTER?: `0x${string}`;
  SCHEMA_ID: readonly bigint[];
  COMPLIANCE_SCHEMA_ID: bigint;
  // Web domains
  PRIMARY_WEB_DOMAIN: string;
  SECONDARY_WEB_DOMAIN: string;
  // Snapshots
  SNAPSHOT_POINTER_DOMAIN: string;
  // Network
  IPFS_GATEWAY: string;
  ASSETHUB_RPCS: readonly string[];
  PEOPLE_GENESIS?: `0x${string}`;
  PEOPLE_RPCS?: readonly string[];
  BULLETIN_RPCS?: readonly string[];
}

export const PASEO_ASSETHUB_NEXT_V2_GENESIS =
  "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f" as const;

export const PREVIEWNET_ASSETHUB_GENESIS =
  "0x4d11c803cc6921429e3876638977ad006ea1bba8cd3976a0bca2f164e7026210" as const;

export const SUMMIT_ASSETHUB_GENESIS =
  "0xf388dc6d6cdf6fb77eac3c4a91f31bc0c8642b142f1a757512ab7849f9f70660" as const;

export const KNOWN_NETWORKS = {
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: {
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
    ATTESTATION_INDEX_RESOLVER: [
      "0x1fa4627395455ec42cfb574c895b5bc5e9e40c4f",
      "0x5d701a1aca551b0e1cd6a00172554e5ff2348104",
    ],
    TRUSTED_ATTESTER_RESOLVER: "0x5abfc89934ee846d12629dfb5b22eecc59bbaed3",
    TRUSTED_ATTESTER: "0x35Cdb23fF7fc86E8DCcd577CA309bFEA9c978D20",
    IPFS_GATEWAY: "https://paseo-bulletin-next-ipfs.polkadot.io",
    PRIMARY_WEB_DOMAIN: "paseo.li",
    SECONDARY_WEB_DOMAIN: "paseoli.dev",
    SNAPSHOT_POINTER_DOMAIN: "browse.dot",
    SCHEMA_ID: [5n, 1n],
    COMPLIANCE_SCHEMA_ID: 6n,
    ASSETHUB_RPCS: ["wss://paseo-asset-hub-next-rpc.polkadot.io"],
    PEOPLE_GENESIS:
      "0xc5af1826b31493f08b7e2a823842f98575b806a784126f28da9608c68665afa5",
    PEOPLE_RPCS: ["wss://paseo-people-next-system-rpc.polkadot.io"],
    BULLETIN_RPCS: ["wss://paseo-bulletin-next-rpc.polkadot.io"],
  },
  [PREVIEWNET_ASSETHUB_GENESIS]: {
    MULTICALL3: "0xB4468000abD87D3c56cbFBd153161223D7b109e5",
    STORE_FACTORY: "0x709A027F446a9e2a4BB9cb9a9c754435b19e32B7",
    CONTENT_RESOLVER: "0x7F74D7CD50f5a834270E2ad395a01b01891AB37d",
    REGISTRY: "0xf34054fd76BbF85f216cf9908226D5f0A72E50CA",
    REGISTRAR: "0x4f06E818Ba3d987704fd91cf3d868E4b019106Ab",
    PUBLISHER: [
      {
        version: "2.1.0",
        address: "0x5a3c111278ec98f327466c9ab7a5e0e0f5047acc",
      },
    ],
    SCHEMA_REGISTRY: "0xccd0a00f015f349264a3d7cd30fa6a05691f01cb",
    ATTESTATION_SERVICE: "0xb6493705c8280e2200ed799e1b47040fa8753d05",
    ATTESTATION_INDEX_RESOLVER: ["0x1563d8f5beab796529d1135d1600a3e75476a1da"],
    TRUSTED_ATTESTER_RESOLVER: "0x956834cd15bf02d3d9bb427e86d7115f5b062927",
    TRUSTED_ATTESTER: "0x35Cdb23fF7fc86E8DCcd577CA309bFEA9c978D20",
    IPFS_GATEWAY: "https://previewnet.substrate.dev",
    PRIMARY_WEB_DOMAIN: "testnet.li",
    SECONDARY_WEB_DOMAIN: "testnet.li",
    SNAPSHOT_POINTER_DOMAIN: "browse.dot",
    SCHEMA_ID: [3n],
    COMPLIANCE_SCHEMA_ID: 2n,
    ASSETHUB_RPCS: ["wss://previewnet.substrate.dev/asset-hub"],
    PEOPLE_GENESIS:
      "0x3138c6d4ce58c760047a413c2a930e919b4673a841ab4890de59aac3bd037f3d",
    PEOPLE_RPCS: ["wss://previewnet.substrate.dev/people"],
    BULLETIN_RPCS: ["wss://previewnet.substrate.dev/bulletin"],
  },
  [SUMMIT_ASSETHUB_GENESIS]: {
    MULTICALL3: "0x1C1044BEa5bDe0F435436bB52A8340fBE1D59847",
    STORE_FACTORY: "0x2947af3CBFb45b89610524a25921C32cB65C4C39",
    CONTENT_RESOLVER: "0xf110e5799c3f0adb8ED885C02c45Ecfe7fD86226",
    REGISTRY: "0xFb7AB7E142ED0248D77198CA8722D67C1930D783",
    REGISTRAR: "0xf3969bCBE60463302306663C62A6A8ef91ab9aA5",
    PUBLISHER: [
      {
        version: "2.1.0",
        address: "0xf5fe0fc9f4c13dfd3a4a8abd27e64eb652157494",
      },
    ],
    SCHEMA_REGISTRY: "0x4d5b7543c380be0446ff9c22b6055990e2aa952a",
    ATTESTATION_SERVICE: "0x40c48a58cdc2797f21325269c4422e717e6510e5",
    ATTESTATION_INDEX_RESOLVER: ["0xa2ea4ab49bbe73f466f2fa0aeb50b39d34b55218"],
    TRUSTED_ATTESTER_RESOLVER: "0xde4a63079034230d71b5a5071571ed3fd95194e0",
    IPFS_GATEWAY: "https://summit-bulletin-rpc.polkadot.io",
    PRIMARY_WEB_DOMAIN: "dot.li",
    SECONDARY_WEB_DOMAIN: "dot.li",
    SNAPSHOT_POINTER_DOMAIN: "browse.dot",
    SCHEMA_ID: [1n],
    COMPLIANCE_SCHEMA_ID: 0n,
    ASSETHUB_RPCS: ["wss://summit-asset-hub-rpc.polkadot.io"],
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

/**
 * The index-resolver to write new attestations against: the newest deployment.
 */
export function activeAttestationResolver(
  network: NetworkConfig,
): `0x${string}` {
  const [active] = network.ATTESTATION_INDEX_RESOLVER;
  if (!active) throw new Error("No attestation index resolver configured");
  return active;
}

/**
 * The schema ID to write new attestations against: the newest registration.
 */
export function activeSchemaId(network: NetworkConfig): bigint {
  const [active] = network.SCHEMA_ID;
  if (active === undefined) throw new Error("No schema ID configured");
  return active;
}

/**
 * One {resolver, schemaId} pair per deployed version, newest first.
 *
 * The resolver and schema arrays are parallel: index i is the resolver and the
 * schema registered together in deployment i. Reads union across every pair so
 * attestations from older versions still surface. Writes use index 0.
 */
export function attestationVersions(
  network: NetworkConfig,
): { resolver: `0x${string}`; schemaId: bigint }[] {
  if (network.ATTESTATION_INDEX_RESOLVER.length !== network.SCHEMA_ID.length) {
    throw new Error(
      "ATTESTATION_INDEX_RESOLVER and SCHEMA_ID must be the same length: one schema per resolver version, same order",
    );
  }
  return network.ATTESTATION_INDEX_RESOLVER.map((resolver, i) => ({
    resolver,
    schemaId: network.SCHEMA_ID[i]!,
  }));
}
