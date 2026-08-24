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
  '0x23e730eb1c6fecae09c917439a5038cb6122d0d48980e8b9bbf0ff56f94a2ca6' as const

export const PREVIEWNET_ASSETHUB_GENESIS =
  '0x627f54413120c81161261b2ca87f60f0020963107dc28367491e09ec2dd29659' as const

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
        version: '3.0.0',
        address: '0x01167f228A729f8e50f18aa7189f59b659155D09'
      },
      {
        version: '2.2.0',
        address: '0x1875B90A61705917945f9B7C6Ff7819Ad48A198e'
      }
    ],
    SCHEMA_REGISTRY: '0x46fe8c29dece5a882be37a459c6e8ba1b73d3f20',
    ATTESTATION_SERVICE: '0x36e63233695675fd5b1f957da746602bd234fe19',
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
    PEOPLE_GENESIS: '0x89a63b11fef2c0273fc72c0d864da0793a665dade5db153e0cab995348c5440f',
    PEOPLE_RPCS: ['wss://paseo-people-next-system-rpc.polkadot.io'],
    BULLETIN_RPCS: ['wss://paseo-bulletin-next-rpc.polkadot.io']
  },
  [PREVIEWNET_ASSETHUB_GENESIS]: {
    MULTICALL3: '0xB4468000abD87D3c56cbFBd153161223D7b109e5',
    STORE_FACTORY: '0x709A027F446a9e2a4BB9cb9a9c754435b19e32B7',
    CONTENT_RESOLVER: '0x7F74D7CD50f5a834270E2ad395a01b01891AB37d',
    REGISTRY: '0xf34054fd76BbF85f216cf9908226D5f0A72E50CA',
    REGISTRAR: '0x4f06E818Ba3d987704fd91cf3d868E4b019106Ab',
    CREATE3_FACTORY: '0x8533c79E058c5a6489CAFeCA86dc600E029D75f5',
    TLD: 'test',
    PUBLISHER: [
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
    IPFS_GATEWAY: 'https://previewnet.substrate.dev',
    PRIMARY_WEB_DOMAIN: 'testnet.li',
    SECONDARY_WEB_DOMAIN: 'testnet.li',
    SNAPSHOT_POINTER_DOMAIN: 'browse.test',
    SCHEMA_ID: [1n],
    COMPLIANCE_SCHEMA_ID: 2n,
    ASSETHUB_RPCS: ['wss://previewnet.substrate.dev/asset-hub'],
    PEOPLE_GENESIS: '0x34999c298555e25bf17a7f3ea20efe7f6fdab1dfec7f808fbcfd36ca8aa5d220',
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
