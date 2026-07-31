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
 * record on a fixed name, and clients read that record. The pointer is the only
 * mutable part of the system, and anyone can resolve it without knowing anything
 * about how the snapshot was produced.
 */

import { decodeString, encodeText, namehash } from '@parity/browse-sdk'

/** Text-record key holding the manifest CID of the `.dot` domain snapshot. */
export const DOMAINS_POINTER_KEY = 'snapshot.domains'

/** Text-record key holding the manifest CID of the username snapshot. */
export const USERNAMES_POINTER_KEY = 'snapshot.usernames'

/**
 * Name the browse snapshot records live on, the same on every network.
 *
 * This is a property of the publisher rather than of the network, which is why
 * it lives here and not in the network config. A different publisher runs its
 * own name and passes it explicitly. The account writing the records has to own
 * this name on whichever network it publishes to.
 */
export const BROWSE_POINTER_DOMAIN = 'browse.dot'

/**
 * Dry-runs a contract read and returns the raw return data.
 *
 * `BrowseSdk.reviveCall` is one. An implementation may open its connection on
 * first call, since nothing here is invoked until a suggestion is asked for.
 */
export type ContractReader = (target: `0x${string}`, data: `0x${string}`) => Promise<`0x${string}`>

/**
 * Read a snapshot manifest CID from a text record, or `null` when the read
 * succeeded and the record is empty.
 *
 * A failed read throws rather than reporting an empty record. The two mean
 * different things to a caller: an empty record stays empty for the session and
 * is worth remembering, while a failed read is worth trying again.
 *
 * ```ts
 * const cid = await readSnapshotPointer(
 *   (target, data) => sdk.reviveCall(target, data),
 *   network.CONTENT_RESOLVER,
 *   'browse.dot',
 *   DOMAINS_POINTER_KEY
 * )
 * ```
 */
export async function readSnapshotPointer(
  read: ContractReader,
  contentResolver: `0x${string}`,
  domain: string,
  key: string
): Promise<string | null> {
  const raw = await read(contentResolver, encodeText(namehash(domain), key))
  const cid = decodeString(raw).trim()
  return cid.length > 0 ? cid : null
}
