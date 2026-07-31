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
 * Client entry point, safe to bundle for a browser.
 *
 * The producer side lives behind `@parity/browse-snapshots/crawl` and
 * `@parity/browse-snapshots/publish`, which pull in node built-ins and
 * transaction signing.
 */

export { cidToBlake2b256DigestHex, MIN_PREFIX_LENGTH, shardKey } from './format.js'
export type { SnapshotManifest } from './format.js'

export { DomainSnapshotService, SnapshotService, UsernameSnapshotService } from './service.js'
export type {
  BlockReader,
  SnapshotPointer,
  SnapshotServiceOptions,
  UsernameEntry
} from './service.js'

export { DOMAINS_POINTER_KEY, readSnapshotPointer, USERNAMES_POINTER_KEY } from './pointer.js'
export type { ContractReader } from './pointer.js'
