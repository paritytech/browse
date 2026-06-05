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

import { decode as decodeContentHashLib, getCodec } from '@ensdomains/content-hash'

/**
 * Decode an ENS-style contenthash blob into its IPFS CID string.
 *
 * Returns `null` for empty data, non-IPFS codecs, or any decode failure.
 */
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
