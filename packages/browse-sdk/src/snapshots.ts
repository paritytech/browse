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
 * Name autocomplete, re-exported so one install covers it.
 *
 * The implementation lives in `@parity/browse-snapshots`, which knows nothing
 * about this package. Keeping it separate is what lets the reader stay free of
 * contract encoding, and lets this package depend on it rather than the reverse.
 */

export * from '../../snapshots/src/index.js'
