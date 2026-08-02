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
 * Name autocomplete, whole. Reading, crawling, and publishing all arrive here.
 *
 * The implementation lives in `@parity/browse-snapshots`, which knows nothing
 * about this package. Keeping it separate is what lets the reader stay free of
 * contract encoding, and lets this package depend on it rather than the reverse.
 *
 * The producer halves reach node built-ins and transaction signing, so a browser
 * must not actually call them. Every export is side-effect free and the package
 * is marked `sideEffects: false`, so a bundler drops whatever the client does not
 * reference.
 */

export * from '../../snapshots/src/index.js'
export * from '../../snapshots/src/host.js'
export * from '../../snapshots/src/publish.js'
export * from './crawl.js'
