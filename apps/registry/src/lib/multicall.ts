import {
  type AggregateResult,
  decodeAggregate3Result,
  encodeAggregate3,
  type MulticallTarget
} from '@parity/browse-sdk'

import { type PaseoHubApi, reviveCall } from './client'
import { NETWORK } from './config'

const MULTICALL_CHUNK_SIZE = 30

/**
 * Execute batched contract reads via Multicall3.aggregate3.
 *
 * Each call has allowFailure=true. Failed sub-calls return `{success: false}`.
 * Routes through this app's rate-limited `reviveCall` adapter (the SDK's
 * BrowseSdk.multicall bypasses that pacing).
 */
export async function multicall(
  calls: MulticallTarget[],
  api?: PaseoHubApi
): Promise<AggregateResult[]> {
  const out: AggregateResult[] = []
  for (let i = 0; i < calls.length; i += MULTICALL_CHUNK_SIZE) {
    const batch = calls.slice(i, i + MULTICALL_CHUNK_SIZE)
    const returnData = await reviveCall(NETWORK.MULTICALL3, encodeAggregate3(batch), undefined, api)
    out.push(...decodeAggregate3Result(returnData))
  }
  return out
}
