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

import { decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem'

const LABEL_DATA_PARAMS = [{ type: 'string' as const }]

/**
 * Wrap a `.dot` label string in the attestation `data` payload format
 * expected by the browse attestation schema.
 */
export function encodeAttestationLabel(label: string): Hex {
  return encodeAbiParameters(LABEL_DATA_PARAMS, [label]) as Hex
}

/**
 * Decode an attestation `data` payload back to its label string, or `null`
 * if the payload is empty / malformed.
 */
export function decodeAttestationLabel(data: Hex | string | undefined): string | null {
  if (!data || data === '0x') return null
  try {
    const [label] = decodeAbiParameters(LABEL_DATA_PARAMS, data as Hex)
    return typeof label === 'string' && label.length > 0 ? label : null
  } catch {
    return null
  }
}
