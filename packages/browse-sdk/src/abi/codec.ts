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

import { type Address, decodeAbiParameters, type Hex } from 'viem'

/** A compliance attestation decoded from `getAttestationById`. */
export interface DecodedAttestation {
  id: bigint
  schema: bigint
  /** Unix seconds the attestation was issued. */
  time: bigint
  /** Unix seconds it expires, or 0 for never. */
  expirationTime: bigint
  /** Unix seconds it was revoked, or 0 while active. */
  revocationTime: bigint
  recipient: Address
  attester: Address
  revocable: boolean
  /** `contentCid` from the `(bool,string)` data payload, when present. */
  cid: string | null
}

/**
 * Decoders are lenient: malformed or empty data returns a sensible default
 * rather than throwing. Combine with {@link tryDecode} on multicall results
 * to surface per-call failures as `null` instead of exceptions.
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

const ATTESTATION_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'id', type: 'uint256' },
    { name: 'schema', type: 'uint256' },
    { name: 'time', type: 'uint64' },
    { name: 'expirationTime', type: 'uint64' },
    { name: 'revocationTime', type: 'uint64' },
    { name: 'refId', type: 'uint256' },
    { name: 'recipient', type: 'address' },
    { name: 'attester', type: 'address' },
    { name: 'revocable', type: 'bool' },
    { name: 'data', type: 'bytes' }
  ]
} as const

/**
 * Decode an `AttestationService.getAttestationById` result into its fields.
 *
 * Returns `null` for a missing attestation (zero-valued struct or a reverted
 * call). The `contentCid` is parsed from the `(bool,string)` data of a
 * `"bool compliant,string contentCid"` schema. It stays `null` for an old
 * `"bool compliant"`-only attestation (the inner decode throws) or an empty CID.
 */
export function decodeAttestation(data: Hex): DecodedAttestation | null {
  try {
    const [decoded] = decodeAbiParameters([ATTESTATION_TUPLE], data)
    const attestation = decoded as unknown as Omit<DecodedAttestation, 'cid'> & { data: Hex }
    // A non-existent id comes back zero-valued. Treat that as "no attestation".
    if (attestation.id === 0n && attestation.time === 0n) return null

    let cid: string | null = null
    if (attestation.data && attestation.data !== '0x') {
      try {
        const [, parsed] = decodeAbiParameters(
          [{ type: 'bool' }, { type: 'string' }],
          attestation.data
        )
        cid = parsed && parsed.length > 0 ? parsed : null
      } catch {
        // Old "bool compliant"-only attestation: no CID.
      }
    }

    return {
      id: attestation.id,
      schema: attestation.schema,
      time: attestation.time,
      expirationTime: attestation.expirationTime,
      revocationTime: attestation.revocationTime,
      recipient: attestation.recipient,
      attester: attestation.attester,
      revocable: attestation.revocable,
      cid
    }
  } catch {
    return null
  }
}
