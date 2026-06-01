import { keccak_256 } from '@noble/hashes/sha3.js'
import { type Address, type Hex, namehash as viemNamehash } from 'viem'

/** ENS-style namehash. Re-exported as the canonical name across the SDK. */
export const namehash = viemNamehash

/** Namehash of the `.dot` TLD. Mirrors `DotnsConstants.DOT_NODE` on-chain. */
const DOT_NODE = namehash('dot')

/** `keccak256(DOT_NODE || labelhash)` cast to uint256 (the registrar's token id). */
export function labelhashToTokenId(labelhash: Hex): bigint {
  const concat = new Uint8Array(64)
  concat.set(hexToBytes(DOT_NODE), 0)
  concat.set(hexToBytes(labelhash), 32)
  return BigInt(`0x${bytesToHex(keccak_256(concat))}`)
}

/** Truncate a 32-byte namehash to its low 20 bytes (the EAS subject form). */
export function nodeToSubject(node: Hex): Address {
  return `0x${node.slice(-40)}` as Address
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
