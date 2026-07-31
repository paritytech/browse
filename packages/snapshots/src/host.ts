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
 * Block reads for products running inside the Parity Host.
 *
 * Kept behind its own subpath so the core stays free of any host dependency. A
 * client reading Bulletin directly, or a test serving blocks from memory, passes
 * its own {@link BlockReader} and never loads this module.
 */

import { getPreimageManager, type HostSubscription } from '@parity/product-sdk/host'

import type { BlockReader } from './service.js'

const DEFAULT_TIMEOUT_MS = 8_000

/**
 * Read snapshot blocks through the host preimage bridge.
 *
 * The bridge only returns bytes whose blake2b-256 hash matches the key it was
 * given, so the CID is the integrity check. Never read these blocks over an IPFS
 * gateway instead, which would drop that guarantee.
 */
export function createHostBlockReader(options: { timeoutMs?: number } = {}): BlockReader {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return (digest) =>
    new Promise((resolve) => {
      let done = false
      let subscription: HostSubscription | undefined
      const settle = (bytes: Uint8Array | null) => {
        if (done) return
        done = true
        clearTimeout(timer)
        subscription?.unsubscribe()
        resolve(bytes)
      }
      // The host answers immediately with null when it has not fetched the bytes
      // yet, then calls back again once it has them. Only real bytes, an
      // interrupt, or the timeout settle the lookup.
      void getPreimageManager().then((preimageManager) => {
        if (done) return
        if (!preimageManager) {
          settle(null)
          return
        }
        subscription = preimageManager.lookup(digest, (bytes) => {
          if (bytes) settle(new Uint8Array(bytes))
        })
        subscription.onInterrupt(() => settle(null))
      })
      const timer = setTimeout(() => settle(null), timeoutMs)
    })
}
