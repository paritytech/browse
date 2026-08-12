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
 * Turning bare labels into full names and back, for whichever TLD a network runs.
 *
 * A network fixes its TLD when its dotNS protocol registry is initialised, and the
 * SDK carries it as `TLD` on the network config. Nothing here writes a suffix
 * literally, so the same code serves a `.dot` network and a `.paseo` one.
 */

/** Suffix a network appends to a label, leading dot included. */
function tldSuffix(tld: string): string {
  return `.${tld}`
}

/** A bare label rendered as the full name for a network, as in `calc.paseo`. */
export function nameWithTld(label: string, tld: string): string {
  return `${label}${tldSuffix(tld)}`
}

/** A name with its TLD suffix removed, lowercased. Leaves a bare label untouched. */
export function stripTld(raw: string, tld: string): string {
  const lowered = raw.toLowerCase()
  const suffix = tldSuffix(tld)
  return lowered.endsWith(suffix) ? lowered.slice(0, -suffix.length) : lowered
}
