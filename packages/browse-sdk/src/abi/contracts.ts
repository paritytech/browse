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

/**
 * Function-data encoders for every browse contract the SDK reads from.
 *
 * Each ABI fragment is kept narrow to the methods actually called. Adding a
 * new call site means adding a single line to the relevant `parseAbi` block
 * and exporting a new `encode…` wrapper.
 */

import { type Address, encodeFunctionData, encodePacked, type Hex, keccak256, parseAbi } from 'viem'

const PUBLISHER_ABI = parseAbi([
  'function getPublished(uint256 offset, uint256 limit) view returns (bytes32[])',
  'function publishedCount() view returns (uint256)'
])

export function encodeGetPublished(offset: bigint, limit: bigint): Hex {
  return encodeFunctionData({
    abi: PUBLISHER_ABI,
    functionName: 'getPublished',
    args: [offset, limit]
  })
}

export function encodePublishedCount(): Hex {
  return encodeFunctionData({ abi: PUBLISHER_ABI, functionName: 'publishedCount' })
}

const REGISTRAR_ABI = parseAbi(['function labelOf(uint256 tokenId) view returns (string)'])

export function encodeLabelOf(tokenId: bigint): Hex {
  return encodeFunctionData({ abi: REGISTRAR_ABI, functionName: 'labelOf', args: [tokenId] })
}

const CONTENT_RESOLVER_ABI = parseAbi([
  'function contenthash(bytes32 node) view returns (bytes)',
  'function text(bytes32 node, string key) view returns (string)'
])

export function encodeContenthash(node: Hex): Hex {
  return encodeFunctionData({
    abi: CONTENT_RESOLVER_ABI,
    functionName: 'contenthash',
    args: [node]
  })
}

export function encodeText(node: Hex, key: string): Hex {
  return encodeFunctionData({
    abi: CONTENT_RESOLVER_ABI,
    functionName: 'text',
    args: [node, key]
  })
}

const REGISTRY_ABI = parseAbi(['function owner(bytes32 node) view returns (address)'])

export function encodeNodeOwner(node: Hex): Hex {
  return encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'owner', args: [node] })
}

const STORE_FACTORY_ABI = parseAbi([
  'function getLabelStores(uint256 offset, uint256 limit) view returns (address[])'
])

const LABEL_STORE_ABI = parseAbi([
  'function getLabels(uint256 offset, uint256 limit) view returns (string[])',
  'function owner() view returns (address)'
])

export function encodeGetLabelStores(offset: bigint, limit: bigint): Hex {
  return encodeFunctionData({
    abi: STORE_FACTORY_ABI,
    functionName: 'getLabelStores',
    args: [offset, limit]
  })
}

export function encodeGetLabels(offset: bigint, limit: bigint): Hex {
  return encodeFunctionData({
    abi: LABEL_STORE_ABI,
    functionName: 'getLabels',
    args: [offset, limit]
  })
}

export function encodeOwner(): Hex {
  return encodeFunctionData({ abi: LABEL_STORE_ABI, functionName: 'owner' })
}

const SCHEMA_REGISTRY_ABI = parseAbi([
  'function schemaCount() view returns (uint256)',
  'function getSchema(uint256 id) view returns ((uint256 id, address registerer, address resolver, bool revocable, bool unique, string schema))'
])

/** `SchemaRegistry.schemaCount()`, the total registered schemas. Ids are sequential. */
export function encodeSchemaCount(): Hex {
  return encodeFunctionData({ abi: SCHEMA_REGISTRY_ABI, functionName: 'schemaCount' })
}

/** `SchemaRegistry.getSchema(id)`, the schema record with its spec and resolver. */
export function encodeGetSchema(id: bigint): Hex {
  return encodeFunctionData({ abi: SCHEMA_REGISTRY_ABI, functionName: 'getSchema', args: [id] })
}

const TRUSTED_ATTESTER_RESOLVER_ABI = parseAbi([
  'function trustedAttester() view returns (address)',
  'function countBySchema(uint256 schema) view returns (uint256)',
  'function listBySchema(uint256 schema, uint64 offset, uint64 limit) view returns (address[])'
])

/** `TrustedAttesterIndexResolver.listBySchema(schema, offset, limit)`, the certified recipients. */
export function encodeListBySchema(schemaId: bigint, offset: bigint, limit: bigint): Hex {
  return encodeFunctionData({
    abi: TRUSTED_ATTESTER_RESOLVER_ABI,
    functionName: 'listBySchema',
    args: [schemaId, offset, limit]
  })
}

/**
 * `TrustedAttesterIndexResolver.trustedAttester()`, the attester address for the
 * authority.
 *
 * Reverts on a resolver that isn't a trusted-attester resolver, which is how we
 * tell an authority schema apart from the recommendation schema during discovery.
 */
export function encodeTrustedAttester(): Hex {
  return encodeFunctionData({ abi: TRUSTED_ATTESTER_RESOLVER_ABI, functionName: 'trustedAttester' })
}

/** `TrustedAttesterIndexResolver.countBySchema(schema)`, the number of certified recipients. */
export function encodeCountBySchema(schemaId: bigint): Hex {
  return encodeFunctionData({
    abi: TRUSTED_ATTESTER_RESOLVER_ABI,
    functionName: 'countBySchema',
    args: [schemaId]
  })
}

const ATTESTATION_ABI = parseAbi([
  'function countByRecipientAndSchema(address recipient, uint256 schemaId) view returns (uint64)',
  'function isActiveAny(address recipient, uint256 schemaId, address[] attesters) view returns (bool)',
  'function isActive(address recipient, uint256 schemaId) view returns (bool)',
  'function identityHasAttested(address recipient, uint256 schemaId, address identity) view returns (bool)'
])

export function encodeCountByRecipientAndSchema(recipient: Address, schemaId: bigint): Hex {
  return encodeFunctionData({
    abi: ATTESTATION_ABI,
    functionName: 'countByRecipientAndSchema',
    args: [recipient, schemaId]
  })
}

export function encodeIsActiveAny(recipient: Address, schemaId: bigint, attesters: Address[]): Hex {
  return encodeFunctionData({
    abi: ATTESTATION_ABI,
    functionName: 'isActiveAny',
    args: [recipient, schemaId, attesters]
  })
}

/**
 * `RecipientAndAttesterIndexResolver.identityHasAttested(recipient, schemaId, identity)`
 *
 * Whether the given identity account has an active attestation for the pair,
 * independent of which product account signed it. Use this rather than
 * `isActiveAny` when the question is "did this identity recommend?", since the
 * attester is a product account bound to the identity, not the identity itself.
 */
export function encodeIdentityHasAttested(
  recipient: Address,
  schemaId: bigint,
  identity: Address
): Hex {
  return encodeFunctionData({
    abi: ATTESTATION_ABI,
    functionName: 'identityHasAttested',
    args: [recipient, schemaId, identity]
  })
}

/**
 * `TrustedAttesterIndexResolver.isActive(recipient, schemaId)`
 */
export function encodeIsActive(recipient: Address, schemaId: bigint): Hex {
  return encodeFunctionData({
    abi: ATTESTATION_ABI,
    functionName: 'isActive',
    args: [recipient, schemaId]
  })
}

const ATTESTATION_SERVICE_ABI = parseAbi([
  'function getAttestationById(uint256 id) view returns ((uint256 id, uint256 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, uint256 refId, address recipient, address attester, bool revocable, bytes data))'
])

/**
 * Encode a read of `AttestationService.getAttestationById(id)`.
 *
 * Returns the full Attestation struct. Decode the `data` field with {@link
 * decodeAttestation}.
 */
export function encodeGetAttestationById(id: bigint): Hex {
  return encodeFunctionData({
    abi: ATTESTATION_SERVICE_ABI,
    functionName: 'getAttestationById',
    args: [id]
  })
}

/**
 * The deterministic attestation id the {@link
 * TrustedAttesterIndexResolver} uses for a unique-schema attestation:
 * `keccak256(abi.encodePacked(trustedAttester, recipient, schema))`. Mirrors the
 * resolver slot so the service `getAttestationById` can be called directly, with
 * no enumeration.
 */
export function trustedAttestationId(
  trustedAttester: Address,
  recipient: Address,
  schemaId: bigint
): bigint {
  const packed = encodePacked(
    ['address', 'address', 'uint256'],
    [trustedAttester, recipient, schemaId]
  )
  return BigInt(keccak256(packed))
}
