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

import { describe, expect, it } from 'vitest'

import { parseRootManifest } from './manifest.js'

const validJson = JSON.stringify({
  $v: 1,
  displayName: 'Browse',
  description: 'Home for your products.',
  icon: { cid: 'bafkrei', format: 'png' }
})

describe('parseRootManifest', () => {
  it('parses a complete manifest', () => {
    const parsed = parseRootManifest(validJson)
    expect(parsed).toEqual({
      $v: 1,
      displayName: 'Browse',
      description: 'Home for your products.',
      icon: { cid: 'bafkrei', format: 'png' }
    })
  })

  it('returns null for empty input', () => {
    expect(parseRootManifest('')).toBeNull()
  })

  it('returns null for non-JSON input', () => {
    expect(parseRootManifest('not json')).toBeNull()
  })

  it('returns null when $v is not 1', () => {
    expect(parseRootManifest(JSON.stringify({ ...JSON.parse(validJson), $v: 2 }))).toBeNull()
  })

  it('returns null when $v is missing', () => {
    const { $v: _omitted, ...rest } = JSON.parse(validJson)
    void _omitted
    expect(parseRootManifest(JSON.stringify(rest))).toBeNull()
  })

  it('returns null when displayName is empty', () => {
    const bad = { ...JSON.parse(validJson), displayName: '' }
    expect(parseRootManifest(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when icon.format is unsupported', () => {
    const bad = { ...JSON.parse(validJson), icon: { cid: 'bafkrei', format: 'svg' } }
    expect(parseRootManifest(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when icon.cid is empty', () => {
    const bad = { ...JSON.parse(validJson), icon: { cid: '', format: 'png' } }
    expect(parseRootManifest(JSON.stringify(bad))).toBeNull()
  })

  it('accepts jpeg as icon format', () => {
    const ok = { ...JSON.parse(validJson), icon: { cid: 'bafkrei', format: 'jpeg' } }
    expect(parseRootManifest(JSON.stringify(ok))?.icon.format).toBe('jpeg')
  })

  it('ignores unknown fields', () => {
    const withExtras = { ...JSON.parse(validJson), extra: 'ignored', kinds: ['widget'] }
    const parsed = parseRootManifest(JSON.stringify(withExtras))
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty('extra')
    expect(parsed).not.toHaveProperty('kinds')
  })
})
