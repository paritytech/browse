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

import { type Address, decodeAbiParameters, encodeFunctionData, type Hex, parseAbi } from 'viem'

export interface MulticallTarget {
  target: string
  callData: Hex
}

export interface AggregateResult {
  success: boolean
  returnData: Hex
}

const MULTICALL3_ABI = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) view returns (Result[])'
])

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

/** Decode one aggregate3 sub-result, swallowing per-call failures as `null`. */
export function tryDecode<T>(
  r: AggregateResult | undefined,
  fn: (d: Hex) => T | null
): T | null {
  if (!r?.success) return null
  try {
    return fn(r.returnData)
  } catch {
    return null
  }
}
