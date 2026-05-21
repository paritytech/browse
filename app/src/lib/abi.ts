import { decode as decodeContentHashLib, getCodec } from '@ensdomains/content-hash'
import { keccak_256 } from '@noble/hashes/sha3.js'
import {
  type Address,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  parseAbi,
  namehash as viemNamehash
} from 'viem'

/** ENS-style namehash; viem-backed. Re-exported as the canonical name across the app. */
export const namehash = viemNamehash

/** Namehash of the `.dot` TLD. Mirrors `DotnsConstants.DOT_NODE` on-chain. */
const DOT_NODE = namehash('dot')

/** `keccak256(DOT_NODE || labelhash)` cast to uint256. */
export function labelhashToTokenId(labelhash: Hex): bigint {
  const concat = new Uint8Array(64)
  concat.set(hexToBytes(DOT_NODE), 0)
  concat.set(hexToBytes(labelhash), 32)
  return BigInt(`0x${bytesToHex(keccak_256(concat))}`)
}

/** Truncate a 32-byte namehash to its low 20 bytes (the form used as the EAS subject). */
export function nodeToSubject(node: Hex): Address {
  return `0x${node.slice(-40)}` as Address
}

const LABEL_DATA_PARAMS = [{ type: 'string' as const }]

export function encodeAttestationLabel(label: string): Hex {
  return encodeAbiParameters(LABEL_DATA_PARAMS, [label]) as Hex
}

export function decodeAttestationLabel(data: Hex | string | undefined): string | null {
  if (!data || data === '0x') return null
  try {
    const [label] = decodeAbiParameters(LABEL_DATA_PARAMS, data as Hex)
    return typeof label === 'string' && label.length > 0 ? label : null
  } catch {
    return null
  }
}

function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(stripped.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const PUBLISHER_ABI = parseAbi([
  'function getPublished(uint256 offset, uint256 limit) view returns (bytes32[])',
  'function publishedCount() view returns (uint256)'
])

const REGISTRAR_ABI = parseAbi(['function labelOf(uint256 tokenId) view returns (string)'])

const CONTENT_RESOLVER_ABI = parseAbi([
  'function contenthash(bytes32 node) view returns (bytes)',
  'function text(bytes32 node, string key) view returns (string)'
])

const ATTESTATION_ABI = parseAbi([
  'function countByRecipientAndSchema(address recipient, uint256 schemaId) view returns (uint64)',
  'function isActiveAny(address recipient, uint256 schemaId, address[] attesters) view returns (bool)'
])

const STORE_FACTORY_ABI = parseAbi([
  'function getLabelStores(uint256 offset, uint256 limit) view returns (address[])'
])

const LABEL_STORE_ABI = parseAbi([
  'function getLabels(uint256 offset, uint256 limit) view returns (string[])',
  'function owner() view returns (address)'
])

const REGISTRY_ABI = parseAbi(['function owner(bytes32 node) view returns (address)'])

const MULTICALL3_ABI = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) view returns (Result[])'
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

export function encodeLabelOf(tokenId: bigint): Hex {
  return encodeFunctionData({ abi: REGISTRAR_ABI, functionName: 'labelOf', args: [tokenId] })
}

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

export function encodeOwner(): Hex {
  return encodeFunctionData({ abi: LABEL_STORE_ABI, functionName: 'owner' })
}

export function encodeNodeOwner(node: Hex): Hex {
  return encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'owner', args: [node] })
}

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

export interface MulticallTarget {
  target: string
  callData: Hex
}

export function encodeAggregate3(calls: MulticallTarget[]): Hex {
  return encodeFunctionData({
    abi: MULTICALL3_ABI,
    functionName: 'aggregate3',
    args: [
      calls.map((call) => ({
        target: call.target as Address,
        allowFailure: true,
        callData: call.callData
      }))
    ]
  })
}

/**
 * Decoders are lenient: malformed or empty data returns a sensible default
 * rather than throwing. Call sites that wrap in `tryDecode` get an extra
 * safety layer; direct callers (e.g. `dotns.ts`'s storeLabels read) rely on
 * the empty-array fallback.
 */
export function decodeAddress(data: Hex): Address {
  try {
    const [addr] = decodeAbiParameters([{ type: 'address' }], data)
    return addr
  } catch {
    return '0x0000000000000000000000000000000000000000'
  }
}

export function decodeAddressArray(data: Hex): Address[] {
  try {
    const [arr] = decodeAbiParameters([{ type: 'address[]' }], data)
    return arr as Address[]
  } catch {
    return []
  }
}

export function decodeBytes32Array(data: Hex): Hex[] {
  try {
    const [arr] = decodeAbiParameters([{ type: 'bytes32[]' }], data)
    return arr as Hex[]
  } catch {
    return []
  }
}

export function decodeStringArray(data: Hex): string[] {
  try {
    const [arr] = decodeAbiParameters([{ type: 'string[]' }], data)
    return arr as string[]
  } catch {
    return []
  }
}

export function decodeBytes(data: Hex): Hex {
  try {
    const [bytes] = decodeAbiParameters([{ type: 'bytes' }], data)
    return bytes
  } catch {
    return '0x'
  }
}

export function decodeString(data: Hex): string {
  try {
    const [str] = decodeAbiParameters([{ type: 'string' }], data)
    return str
  } catch {
    return ''
  }
}

export function decodeUint64(data: Hex): number | null {
  try {
    const [val] = decodeAbiParameters([{ type: 'uint64' }], data)
    return Number(val)
  } catch {
    return null
  }
}

export function decodeBool(data: Hex): boolean {
  try {
    const [b] = decodeAbiParameters([{ type: 'bool' }], data)
    return b
  } catch {
    return false
  }
}

export interface AggregateResult {
  success: boolean
  returnData: Hex
}

export function decodeAggregate3Result(data: Hex): AggregateResult[] {
  try {
    const [results] = decodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            { type: 'bool', name: 'success' },
            { type: 'bytes', name: 'returnData' }
          ]
        }
      ],
      data
    )
    return results as AggregateResult[]
  } catch {
    return []
  }
}

export function decodeIpfsContenthash(contenthashHex: string): string | null {
  const hex = contenthashHex.startsWith('0x') ? contenthashHex.slice(2) : contenthashHex
  if (!hex || hex === '0' || hex.length < 4) return null
  try {
    if (getCodec(hex) !== 'ipfs') return null
    return decodeContentHashLib(hex) || null
  } catch {
    return null
  }
}
