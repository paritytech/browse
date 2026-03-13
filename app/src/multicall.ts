// Multicall3 batching with chunking.
// Chunks calls into groups of MULTICALL_CHUNK_SIZE to avoid gas overflow.

import { CONTRACTS, MULTICALL_CHUNK_SIZE } from "./config";
import {
  encodeAggregate3,
  decodeAggregate3Result,
  type MulticallTarget,
  type AggregateResult,
} from "./abi";
import { reviveCall } from "./chain";

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Execute batched contract reads via Multicall3.aggregate3.
 * Automatically chunks into groups of 30 to avoid gas limits.
 * Each call has allowFailure=true — failed sub-calls return {success: false}.
 */
export async function multicall(
  calls: MulticallTarget[],
): Promise<AggregateResult[]> {
  if (calls.length === 0) return [];

  const batches = chunk(calls, MULTICALL_CHUNK_SIZE);
  const results: AggregateResult[] = [];

  for (const batch of batches) {
    const calldata = encodeAggregate3(batch);
    const returnData = await reviveCall(CONTRACTS.MULTICALL3, calldata);
    const batchResults = decodeAggregate3Result(returnData);
    results.push(...batchResults);
  }

  return results;
}
