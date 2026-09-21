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

import type { Deployment } from './types.js'

export interface NetworkConfig {
  /** Dotns */
  STORE_FACTORY: `0x${string}`
  REGISTRY: `0x${string}`
  REGISTRAR: `0x${string}` // https://github.com/paritytech/dotns/blob/master/contracts/registrars/DotnsRegistrar.sol
  CONTENT_RESOLVER: `0x${string}` // https://github.com/paritytech/dotns/blob/master/contracts/resolvers/DotnsContentResolver.sol
  MULTICALL3: `0x${string}` // https://github.com/paritytech/dotns/blob/master/contracts/utils/Multicall3.sol
  CREATE3_FACTORY: `0x${string}` | null // https://github.com/paritytech/dotns/blob/master/contracts/deploy/Create3Factory.sol
  TLD: string
  /** Browse */
  PUBLISHER: readonly Deployment[] // https://github.com/paritytech/browse/blob/main/evm/src/Publisher.sol
  /** Attestation Protocol */
  SCHEMA_REGISTRY: `0x${string}`
  ATTESTATION_SERVICE: `0x${string}`
  ATTESTATION_INDEX_RESOLVER: readonly `0x${string}`[]
  TRUSTED_ATTESTER_RESOLVER: `0x${string}`
  TRUSTED_ATTESTER?: `0x${string}`
  SCHEMA_ID: readonly bigint[]
  COMPLIANCE_SCHEMA_ID: bigint
  /** Web domains */
  PRIMARY_WEB_DOMAIN: string
  SECONDARY_WEB_DOMAIN: string
  /** Snapshots */
  SNAPSHOT_POINTER_DOMAIN: string
  /** Network */
  IPFS_GATEWAY: string
  ASSETHUB_RPCS: readonly string[]
  PEOPLE_GENESIS?: `0x${string}`
  PEOPLE_RPCS?: readonly string[]
  BULLETIN_RPCS?: readonly string[]
}

export const PASEONEXTV2_ASSETHUB_GENESIS =
  '0x4349b00e54897e21196fd331015fc5be0f14e118beb0375ed2bb1793737bb57a' as const

export const PREVIEWNET_ASSETHUB_GENESIS =
  '0xc27c8bf3f13f96dc2130cd2b0a3debe57618fd02521ecc1902bd7dd4ed83d2fe' as const

export const KNOWN_NETWORKS = {
  [PASEONEXTV2_ASSETHUB_GENESIS]: {
    MULTICALL3: '0xB4468000abD87D3c56cbFBd153161223D7b109e5',
    STORE_FACTORY: '0x709A027F446a9e2a4BB9cb9a9c754435b19e32B7',
    CONTENT_RESOLVER: '0x7F74D7CD50f5a834270E2ad395a01b01891AB37d',
    REGISTRY: '0xf34054fd76BbF85f216cf9908226D5f0A72E50CA',
    REGISTRAR: '0x4f06E818Ba3d987704fd91cf3d868E4b019106Ab',
    CREATE3_FACTORY: '0x8533c79E058c5a6489CAFeCA86dc600E029D75f5',
    TLD: 'paseo',
    PUBLISHER: [
      {
        version: '3.1.0',
        address: '0xAa189B1D4F65CF6e5D0baD734F6C876f2E12F984'
      },
      {
        version: '3.0.0',
        address: '0x01167f228A729f8e50f18aa7189f59b659155D09'
      }
    ],
    SCHEMA_REGISTRY: '0xd8af2626d3c5d990ae75077de3c5d9bb5e71de1e',
    ATTESTATION_SERVICE: '0x37e7021fd6e44d5cdc17847b33388d6d6eff63cd',
    ATTESTATION_INDEX_RESOLVER: ['0xAca17c2547f09b3AD0d3bd28Db11EE172604b85b'],
    TRUSTED_ATTESTER_RESOLVER: '0x8326c11a76Dda4702046e92f73C0ea7E698560a2',
    TRUSTED_ATTESTER: '0x35Cdb23fF7fc86E8DCcd577CA309bFEA9c978D20',
    IPFS_GATEWAY: 'https://paseo-bulletin-next-ipfs.polkadot.io',
    PRIMARY_WEB_DOMAIN: 'paseo.li',
    SECONDARY_WEB_DOMAIN: 'paseoli.dev',
    SNAPSHOT_POINTER_DOMAIN: 'browse.paseo',
    SCHEMA_ID: [1n],
    COMPLIANCE_SCHEMA_ID: 2n,
    ASSETHUB_RPCS: ['wss://paseo-asset-hub-next-rpc.polkadot.io'],
    PEOPLE_GENESIS: '0x4a2b5b737de1da59e209b0000a876ec2fa20035dc34fd292a848da32d255ad48',
    PEOPLE_RPCS: ['wss://paseo-people-next-system-rpc.polkadot.io'],
    BULLETIN_RPCS: ['wss://paseo-bulletin-next-rpc.polkadot.io']
  },
  [PREVIEWNET_ASSETHUB_GENESIS]: {
    MULTICALL3: '0xB4468000abD87D3c56cbFBd153161223D7b109e5',
    STORE_FACTORY: '0x99605a926FcB40aB520F659c6505E5ff862771f6',
    CONTENT_RESOLVER: '0x7F74D7CD50f5a834270E2ad395a01b01891AB37d',
    REGISTRY: '0xf34054fd76BbF85f216cf9908226D5f0A72E50CA',
    REGISTRAR: '0x4f06E818Ba3d987704fd91cf3d868E4b019106Ab',
    CREATE3_FACTORY: '0x8533c79E058c5a6489CAFeCA86dc600E029D75f5',
    TLD: 'testnet',
    PUBLISHER: [
      {
        version: '3.1.0',
        address: '0x01167f228A729f8e50f18aa7189f59b659155D09'
      }
    ],
    // attestation-protocol 1.0.0, CREATE3 through the factory above.
    SCHEMA_REGISTRY: '0x90e2a80f6c59C2e1cbd0Be50f60bA56bae4ADE97',
    ATTESTATION_SERVICE: '0xA722702956694BFF0Ad6689df0505C3e357Bf0F1',
    // The identity-bound resolver, salt 2.1.1; 0xAca17c25… holds the src/
    // build here since the 2026-09-21 recovery (see evm/deployments.json).
    ATTESTATION_INDEX_RESOLVER: ['0xE5c4C005093828e12bB0A427A74ECAe1601218b6'],
    TRUSTED_ATTESTER_RESOLVER: '0x8326c11a76Dda4702046e92f73C0ea7E698560a2',
    TRUSTED_ATTESTER: '0x35Cdb23fF7fc86E8DCcd577CA309bFEA9c978D20',
    IPFS_GATEWAY: 'https://previewnet.substrate.dev',
    PRIMARY_WEB_DOMAIN: 'testnet.li',
    SECONDARY_WEB_DOMAIN: 'testnet.li',
    SNAPSHOT_POINTER_DOMAIN: 'browse.testnet',
    // Registered against the 2.1.1 resolver; ids 1 to 5 are wrong or stale.
    SCHEMA_ID: [6n],
    COMPLIANCE_SCHEMA_ID: 2n,
    ASSETHUB_RPCS: ['wss://previewnet.substrate.dev/asset-hub'],
    PEOPLE_GENESIS: '0xf720c28fe3315e67fa799a616fc59abad47dd257b1a336af6538435844d35218',
    PEOPLE_RPCS: ['wss://previewnet.substrate.dev/people'],
    BULLETIN_RPCS: ['wss://previewnet.substrate.dev/bulletin']
  }
} as const satisfies Record<string, NetworkConfig>

export type NetworkGenesis = keyof typeof KNOWN_NETWORKS

export function isKnownGenesis(genesis: string): genesis is NetworkGenesis {
  return Object.prototype.hasOwnProperty.call(KNOWN_NETWORKS, genesis)
}

export function selectNetwork(genesis: NetworkGenesis): NetworkConfig {
  return KNOWN_NETWORKS[genesis]
}

/**
 * Every Publisher address to read listings from, write target first.
 *
 * Reads union across all deployments so a redeploy doesn't strand the listings
 * published to an older registry. Empty on networks without a Publisher.
 *
 * The first entry is the one writes go to, which is normally also the newest.
 * A deployment whose storage has not been migrated yet is ordered after the
 * registry still holding the listings, so the two can disagree.
 */
export function publisherReadAddresses(network: NetworkConfig): `0x${string}`[] {
  return network.PUBLISHER.map((deployment) => deployment.address)
}

/**
 * The index-resolver to write new attestations against: the newest deployment.
 */
export function activeAttestationResolver(network: NetworkConfig): `0x${string}` {
  const [active] = network.ATTESTATION_INDEX_RESOLVER
  if (!active) throw new Error('No attestation index resolver configured')
  return active
}

/**
 * The schema ID to write new attestations against: the newest registration.
 */
export function activeSchemaId(network: NetworkConfig): bigint {
  const [active] = network.SCHEMA_ID
  if (active === undefined) throw new Error('No schema ID configured')
  return active
}

/**
 * One {resolver, schemaId} pair per deployed version, newest first.
 *
 * The resolver and schema arrays are parallel: index i is the resolver and the
 * schema registered together in deployment i. Reads union across every pair so
 * attestations from older versions still surface. Writes use index 0.
 */
export function attestationVersions(
  network: NetworkConfig
): { resolver: `0x${string}`; schemaId: bigint }[] {
  if (network.ATTESTATION_INDEX_RESOLVER.length !== network.SCHEMA_ID.length) {
    throw new Error(
      'ATTESTATION_INDEX_RESOLVER and SCHEMA_ID must be the same length: one schema per resolver version, same order'
    )
  }
  return network.ATTESTATION_INDEX_RESOLVER.map((resolver, i) => ({
    resolver,
    schemaId: network.SCHEMA_ID[i]!
  }))
}
