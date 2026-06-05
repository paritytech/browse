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
