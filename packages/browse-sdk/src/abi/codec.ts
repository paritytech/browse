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
  /** Description document CID from the data payload, or null. */
  cid: string | null
  /** Badge image CID from the data payload, or null. */
  badgeIconCid: string | null
  /** Certificate name from the data payload, or null. */
  name: string | null
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

export function decodeUint(data: Hex): bigint | null {
  try {
    const [v] = decodeAbiParameters([{ type: 'uint256' }], data)
    return v
  } catch {
    return null
  }
}

/** A schema record decoded from `SchemaRegistry.getSchema`. */
export interface DecodedSchema {
  id: bigint
  resolver: Address
  schema: string
  unique: boolean
}

const SCHEMA_RECORD_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'id', type: 'uint256' },
    { name: 'registerer', type: 'address' },
    { name: 'resolver', type: 'address' },
    { name: 'revocable', type: 'bool' },
    { name: 'unique', type: 'bool' },
    { name: 'schema', type: 'string' }
  ]
} as const

/** Decode a `SchemaRegistry.getSchema` result, or null on a malformed or empty read. */
export function decodeSchemaRecord(data: Hex): DecodedSchema | null {
  try {
    const [record] = decodeAbiParameters([SCHEMA_RECORD_TUPLE], data)
    const r = record as unknown as {
      id: bigint
      resolver: Address
      schema: string
      unique: boolean
    }
    return { id: r.id, resolver: r.resolver, schema: r.schema, unique: r.unique }
  } catch {
    return null
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

const nonEmpty = (value: string | undefined): string | null =>
  value && value.length > 0 ? value : null

/**
 * Decode an `AttestationService.getAttestationById` result into its fields.
 *
 * Returns `null` for a missing attestation (zero-valued struct or a reverted
 * call). Parses the data payload of the
 * `"bool compliant,string contentCid,string badgeIconCid,string name"` schema,
 * falling back to the legacy `"bool compliant,string contentCid"` and
 * `"bool compliant"` shapes. Missing fields stay `null`.
 */
export function decodeAttestation(data: Hex): DecodedAttestation | null {
  try {
    const [decoded] = decodeAbiParameters([ATTESTATION_TUPLE], data)
    const attestation = decoded as unknown as Omit<
      DecodedAttestation,
      'cid' | 'badgeIconCid' | 'name'
    > & { data: Hex }
    // A non-existent id comes back zero-valued. Treat that as "no attestation".
    if (attestation.id === 0n && attestation.time === 0n) return null

    let cid: string | null = null
    let badgeIconCid: string | null = null
    let name: string | null = null
    if (attestation.data && attestation.data !== '0x') {
      try {
        const [, contentCid, badge, certName] = decodeAbiParameters(
          [{ type: 'bool' }, { type: 'string' }, { type: 'string' }, { type: 'string' }],
          attestation.data
        )
        cid = nonEmpty(contentCid)
        badgeIconCid = nonEmpty(badge)
        name = nonEmpty(certName)
      } catch {
        // Legacy shapes: "bool compliant,string contentCid" or "bool compliant".
        try {
          const [, contentCid] = decodeAbiParameters(
            [{ type: 'bool' }, { type: 'string' }],
            attestation.data
          )
          cid = nonEmpty(contentCid)
        } catch {
          // "bool compliant"-only: nothing more to parse.
        }
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
      cid,
      badgeIconCid,
      name
    }
  } catch {
    return null
  }
}
