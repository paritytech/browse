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

import { decodeAbiParameters, encodeFunctionData, namehash, parseAbi } from 'viem'

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
 * Dry-runs a contract read and returns the raw return data.
 *
 * `BrowseSdk.reviveCall` is one. An implementation may open its connection on
 * first call, since nothing here is invoked until a suggestion is asked for.
 */
export type ContractReader = (target: `0x${string}`, data: `0x${string}`) => Promise<`0x${string}`>

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
 *   (target, data) => sdk.reviveCall(target, data),
 *   network.CONTENT_RESOLVER,
 *   'browse.dot',
 *   DOMAINS_POINTER_KEY
 * )
 * ```
 */
export async function getSnapshotPointer(
  read: ContractReader,
  contentResolver: `0x${string}`,
  domain: string,
  key: string
): Promise<string | null> {
  const raw = await read(contentResolver, encodeTextRead(domain, key))
  const [cid] = decodeAbiParameters([{ type: 'string' }], raw)
  return cid.trim().length > 0 ? cid.trim() : null
}
