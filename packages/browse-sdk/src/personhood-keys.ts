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
 * RFC-0022 key derivation, the scheme every Polkadot app has derived from
 * since 2026-07-28.
 *
 * It replaced the ad-hoc paths that came before, in particular
 * `blake2b256_keyed(entropy, "candidate")`, which no app produces any more. A
 * key derived the old way is invisible to the personhood faucet and to
 * `Members.Members`, so a fixture still using it looks like a person with no
 * personhood rather than like a bug.
 *
 * Ring-VRF member keys hang off a keyed-hash chain rooted in the raw BIP-39
 * entropy, not the mini secret and not the 64 byte seed:
 *
 * ```
 * root  = blake2b256(entropy, key: "ring-vrf")
 * child = blake2b256(parent, key: chain_code)
 * path  = //{productId}//index_bytes(n)
 * ```
 *
 * A `productId` is a dotNS name with its TLD, and it enters the chain as a
 * junction chain code, so **every key moves when the TLD moves**. The same
 * mnemonic is a different person under `peopl.dot` than under `peopl.test`.
 * Nothing here defaults the TLD. Pass the one the network registers names
 * under, which is `TLD` on its {@link NetworkConfig}.
 *
 * Spec: paritytech/truapi `docs/rfcs/0022-account-derivations.md`. The same
 * derivation is implemented in iOS `KeyedHashChainDeriverTests`, Android
 * `KeyedEntropyDerivationTest` and truapi `product_account.rs`, and all of them
 * have to agree byte for byte. A key derived even slightly differently is not
 * rejected anywhere, it simply belongs to nobody.
 */

import { blake2b } from '@noble/hashes/blake2.js'

const utf8 = (value: string) => new TextEncoder().encode(value)

const blake2b256 = (data: Uint8Array) => blake2b(data, { dkLen: 32 })

/** `hash(data, key)`, BLAKE2b-256 in keyed mode. */
const keyedHash = (data: Uint8Array, key: Uint8Array) => blake2b(data, { key, dkLen: 32 })

const CHAIN_CODE_BYTES = 32
const DERIVATION_INDEX_BYTES = 32

/** Root of the ring-VRF tree. */
const RING_VRF_ROOT_KEY = utf8('ring-vrf')

/** Governance-reserved label for the personhood ring-VRF domain. */
const PERSONHOOD_LABEL = 'peopl'

/**
 * `blake2b256("product-account-index")[..28]`.
 *
 * Keeps plain `u32` indices and raw 32 byte selectors in separate spaces, so a
 * raw value only collides with an index when it happens to end in the magic.
 */
export const INDEX_MAGIC: Uint8Array = blake2b256(utf8('product-account-index')).subarray(0, 28)

/** SCALE compact length prefix, single, two, and four byte modes. */
function compactLength(length: number): Uint8Array {
  if (length < 1 << 6) return Uint8Array.of(length << 2)
  if (length < 1 << 14) {
    const value = (length << 2) | 0b01
    return Uint8Array.of(value & 0xff, value >>> 8)
  }
  const value = (length << 2) | 0b10
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24)
}

/**
 * `index_bytes(n)`, the 32 byte derivation index for a plain `u32`.
 *
 * The index little-endian followed by {@link INDEX_MAGIC}. A product default
 * account is index 0.
 */
export function indexBytes(index: number): Uint8Array {
  const out = new Uint8Array(DERIVATION_INDEX_BYTES)
  new DataView(out.buffer).setUint32(0, index, true)
  out.set(INDEX_MAGIC, 4)
  return out
}

/**
 * A path segment as a 32 byte junction chain code.
 *
 * SCALE-encoded and zero-padded, or hashed when the encoding exceeds 32 bytes,
 * so a long name cannot collide with a truncation of itself.
 */
export function junctionChainCode(segment: string): Uint8Array {
  const bytes = utf8(segment)
  const encoded = new Uint8Array([...compactLength(bytes.length), ...bytes])
  const out = new Uint8Array(CHAIN_CODE_BYTES)
  out.set(encoded.length > CHAIN_CODE_BYTES ? blake2b256(encoded) : encoded)
  return out
}

/** The dotNS name a built-in feature has under `tld`. */
export function builtInProductId(label: string, tld: string): string {
  return `${label}.${tld}`
}

/** Root of the ring-VRF tree for a mnemonic BIP-39 entropy. */
export function ringVrfRootEntropy(entropy: Uint8Array): Uint8Array {
  return keyedHash(entropy, RING_VRF_ROOT_KEY)
}

/**
 * Ring-VRF entropy at `//{domain}//index_bytes(index)`.
 *
 * Hard junctions only. Soft derivation has no meaning in this tree.
 */
export function deriveRingVrfEntropy(entropy: Uint8Array, domain: string, index = 0): Uint8Array {
  return [junctionChainCode(domain), indexBytes(index)].reduce(
    (parent, chainCode) => keyedHash(parent, chainCode),
    ringVrfRootEntropy(entropy)
  )
}

/**
 * Entropy behind the bandersnatch member key the People chain knows a full
 * person by, at `//peopl.{tld}//index_bytes(0)`.
 *
 * This is the key `Members.Members` and `People.Keys` are keyed on, and the
 * one the personhood faucet has to recognize before a claim mints anything.
 */
export function fullPersonRingVrfEntropy(entropy: Uint8Array, tld: string): Uint8Array {
  return deriveRingVrfEntropy(entropy, builtInProductId(PERSONHOOD_LABEL, tld), 0)
}

/** Light-person ring-VRF entropy, at `//peopl.{tld}//index_bytes(1)`. */
export function lightPersonRingVrfEntropy(entropy: Uint8Array, tld: string): Uint8Array {
  return deriveRingVrfEntropy(entropy, builtInProductId(PERSONHOOD_LABEL, tld), 1)
}
