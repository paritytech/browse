import {
  type AggregateResult,
  decodeAggregate3Result,
  encodeAggregate3,
  type MulticallTarget
} from './abi'
import { type PaseoHubApi, reviveCall } from './client'
import { BACKEND } from './config'

const MULTICALL_CHUNK_SIZE = 30

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Execute batched contract reads via Multicall3.aggregate3.
 * Automatically chunks into groups of 30 to avoid gas limits.
 * Each call has allowFailure=true — failed sub-calls return {success: false}.
 */
export async function multicall(
  calls: MulticallTarget[],
  api?: PaseoHubApi
): Promise<AggregateResult[]> {
  if (calls.length === 0) return []

  const batches = chunk(calls, MULTICALL_CHUNK_SIZE)
  const results: AggregateResult[] = []

  for (const batch of batches) {
    const calldata = encodeAggregate3(batch)
    const returnData = await reviveCall(BACKEND.MULTICALL3, calldata, undefined, api)
    const batchResults = decodeAggregate3Result(returnData)
    results.push(...batchResults)
  }

  return results
}
