/**
 * Function-data encoders for every browse contract the SDK reads from.
 *
 * Each ABI fragment is kept narrow to the methods actually called. Adding a
 * new call site means adding a single line to the relevant `parseAbi` block
 * and exporting a new `encode…` wrapper.
 */

import { type Address, encodeFunctionData, type Hex, parseAbi } from 'viem'

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

const ATTESTATION_ABI = parseAbi([
  'function countByRecipientAndSchema(address recipient, uint256 schemaId) view returns (uint64)',
  'function isActiveAny(address recipient, uint256 schemaId, address[] attesters) view returns (bool)'
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
