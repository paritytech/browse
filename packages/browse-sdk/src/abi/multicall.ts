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
