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

/**
 * Where a client learns the current snapshot from.
 *
 * Snapshot blocks are immutable, so their CIDs change every time the crawler
 * runs. Baking a CID into a client at build time pins it to whatever was current
 * the day it shipped. Instead the publisher records the manifest CID in a text
 * record, and clients read that record. The pointer is the only mutable part of
 * the system, and anyone can resolve it without knowing anything about how the
 * snapshot was produced.
 *
 * The record lives on the name the publisher deployed to, which is the name its
 * key already owns. Callers supply it, since only they know where they deployed.
 */

import {
  bytesToHex,
  decodeAbiParameters,
  encodeFunctionData,
  hexToBytes,
  namehash,
  parseAbi
} from 'viem'

// Narrow to the two record calls a pointer needs. Encoding them here rather than
// borrowing from browse-sdk is what keeps this package free of it, so browse-sdk
// can depend on this one instead of the other way around.
const CONTENT_RESOLVER_ABI = parseAbi([
  'function text(bytes32 node, string key) view returns (string)',
  'function setText(bytes32 node, string key, string value)'
])

/** Call data for reading a text record. */
export function encodeTextRead(domain: string, key: string): `0x${string}` {
  return encodeFunctionData({
    abi: CONTENT_RESOLVER_ABI,
    functionName: 'text',
    args: [namehash(domain), key]
  })
}

/** Call data for writing a text record, callable only by the name owner. */
export function encodeTextWrite(domain: string, key: string, value: string): `0x${string}` {
  return encodeFunctionData({
    abi: CONTENT_RESOLVER_ABI,
    functionName: 'setText',
    args: [namehash(domain), key, value]
  })
}

/** Text-record key holding the manifest CID of the `.dot` domain snapshot. */
export const DOMAINS_POINTER_KEY = 'snapshot.domains'

/** Text-record key holding the manifest CID of the username snapshot. */
export const USERNAMES_POINTER_KEY = 'snapshot.usernames'

/**
 * Origin for a read that needs a caller but not an authenticated one. This is
 * the SS58 form of the H160 zero address under the pallet-revive mapping.
 */
const DRY_RUN_ORIGIN = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1'

/**
 * The one runtime call a pointer read makes.
 *
 * A papi api satisfies this, so callers hand over the instance they already
 * have rather than wrapping it. Field names match what pallet-revive declares,
 * which is what lets a caller passing generated descriptors fail the build
 * instead of the lookup.
 */
export interface NetworkProvider {
  apis: {
    ReviveApi: {
      call: (
        origin: string,
        dest: `0x${string}`,
        value: bigint,
        weightLimit: { ref_time: bigint; proof_size: bigint } | undefined,
        storageDepositLimit: bigint | undefined,
        inputData: Uint8Array
      ) => Promise<{
        result:
          | { success: true; value: { flags: unknown; data: Uint8Array } }
          | { success: false; value: unknown }
      }>
    }
  }
}

/**
 * Supplies the network api, either directly or through an accessor.
 *
 * Mirrors the preimage side, so a caller holding an instance passes it and one
 * still connecting passes the accessor it already has.
 */
export type NetworkProviderSource =
  NetworkProvider | (() => NetworkProvider | null | Promise<NetworkProvider | null>)

/**
 * Fetch a snapshot manifest CID from a text record, or `null` when the read
 * succeeded and the record is empty.
 *
 * A failed read throws rather than reporting an empty record. The two mean
 * different things to a caller: an empty record stays empty for the session and
 * is worth remembering, while a failed read is worth trying again.
 *
 * ```ts
 * const cid = await getSnapshotPointer(
 *   client.getTypedApi(paseohub),
 *   network.CONTENT_RESOLVER,
 *   'browse.dot',
 *   DOMAINS_POINTER_KEY
 * )
 * ```
 */
export async function getSnapshotPointer(
  chain: NetworkProvider,
  contentResolver: `0x${string}`,
  domain: string,
  key: string
): Promise<string | null> {
  const { result } = await chain.apis.ReviveApi.call(
    DRY_RUN_ORIGIN,
    contentResolver,
    0n,
    undefined,
    undefined,
    hexToBytes(encodeTextRead(domain, key))
  )
  if (!result.success) throw new Error(`Pointer read failed to dispatch for ${domain}`)
  // A reverting contract reports success and sets the low flag, the same shape
  // browse-sdk checks after its own dry-runs.
  if ((Number(result.value.flags) & 1) === 1) {
    throw new Error(`Pointer read reverted for ${domain}`)
  }
  const [cid] = decodeAbiParameters([{ type: 'string' }], bytesToHex(result.value.data))
  return cid.trim().length > 0 ? cid.trim() : null
}
