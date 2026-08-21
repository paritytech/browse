import { describe, expect, test } from 'vitest'

import {
  INDEX_MAGIC,
  deriveRingVrfEntropy,
  fullPersonRingVrfEntropy,
  indexBytes,
  junctionChainCode,
  lightPersonRingVrfEntropy,
  ringVrfRootEntropy
} from './rfc0022.js'

const hex = (bytes: Uint8Array) =>
  '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * The cross-platform contract for RFC-0022, pinned identically in iOS
 * `KeyedHashChainDeriverTests`, Android `KeyedEntropyDerivationTest` and
 * truapi `product_account.rs`. Root entropy 0x0102…20 is the fixture all
 * three use, under the `.dot` product identities they hard-code.
 */
const ROOT_ENTROPY = Uint8Array.from({ length: 32 }, (_, i) => i + 1)

describe('derivation index works', () => {
  test('INDEX_MAGIC is the first 28 bytes of blake2b256("product-account-index")', () => {
    // Given
    // When
    // Then
    expect(hex(INDEX_MAGIC)).toBe('0x12e86013736c5498f050b03cdc16957dff0e422fb92ca77ec3ab168f')
  })

  test('index_bytes lays out the index little-endian followed by the magic', () => {
    // Given
    // When
    // Then
    expect(hex(indexBytes(0))).toBe(
      '0x0000000012e86013736c5498f050b03cdc16957dff0e422fb92ca77ec3ab168f'
    )
    expect(hex(indexBytes(5))).toBe(
      '0x0500000012e86013736c5498f050b03cdc16957dff0e422fb92ca77ec3ab168f'
    )
  })
})

describe('junction chain code works', () => {
  test('a segment is SCALE-encoded and zero-padded to 32 bytes', () => {
    // Given
    // When
    // Then
    expect(hex(junctionChainCode('peopl.dot'))).toBe(
      '0x2470656f706c2e646f7400000000000000000000000000000000000000000000'
    )
  })

  test('a segment longer than 32 encoded bytes is hashed rather than truncated', () => {
    // Given
    const long = 'w-credentialless-staticblitz-com.webcontainer-api.io'

    // When
    const chainCode = junctionChainCode(long)

    // Then
    expect(chainCode).toHaveLength(32)
    expect(chainCode.subarray(1, 5)).not.toEqual(new TextEncoder().encode(long).subarray(0, 4))
  })
})

describe('ring-VRF derivation works', () => {
  test('the tree root is the entropy keyed with "ring-vrf"', () => {
    // Given
    // When
    // Then
    expect(hex(ringVrfRootEntropy(ROOT_ENTROPY))).toBe(
      '0x372b08255c7798fe3193756296005adc4c44adb9f3986fb718aa98a48b4bf725'
    )
  })

  test('the full and light person entropies match the peopl.dot vectors', () => {
    // Given
    // When
    // Then
    expect(hex(fullPersonRingVrfEntropy(ROOT_ENTROPY, 'dot'))).toBe(
      '0xc47086f94a7f4c05b7afd9f2339d3fea168f3823b5424ba1f7b31043d8ef60af'
    )
    expect(hex(lightPersonRingVrfEntropy(ROOT_ENTROPY, 'dot'))).toBe(
      '0x8d7f5e1510a7e8d813887e100f5a260ec9de60e68695477b93360ee7e3d16a9f'
    )
  })

  test('a full person is peopl.{tld} at index 0', () => {
    // Given
    // When
    // Then
    expect(fullPersonRingVrfEntropy(ROOT_ENTROPY, 'paseo')).toEqual(
      deriveRingVrfEntropy(ROOT_ENTROPY, 'peopl.paseo', 0)
    )
  })

  test('each TLD is a disjoint person', () => {
    // Given
    // When
    const keys = ['dot', 'paseo', 'test'].map((tld) =>
      hex(fullPersonRingVrfEntropy(ROOT_ENTROPY, tld))
    )

    // Then
    expect(new Set(keys).size).toBe(3)
  })
})
