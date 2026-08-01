import { gzipSync } from 'node:zlib'

import { blake2b } from '@noble/hashes/blake2.js'
import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import { describe, expect, it } from 'vitest'

import {
  BLAKE2B_256,
  blockCid,
  cidToBlake2b256DigestHex,
  digestToCid,
  gunzip,
  isSnapshotManifest,
  lowerBound,
  parseManifest,
  RAW_CODEC,
  shardKey,
  type SnapshotManifest
} from './format.js'

/** The reference implementation this package deliberately does not depend on. */
function referenceCid(bytes: Uint8Array): string {
  return CID.createV1(
    RAW_CODEC,
    Digest.create(BLAKE2B_256, blake2b(bytes, { dkLen: 32 }))
  ).toString()
}

const identity = (value: string) => value

describe('content addressing works', () => {
  it('matches multiformats for arbitrary block bytes', () => {
    // Given
    const cases = [
      new Uint8Array(0),
      new TextEncoder().encode('hello'),
      new Uint8Array(Array.from({ length: 256 }, (_, i) => i)),
      new Uint8Array(gzipSync(Buffer.from('alpha\nbeta\ngamma\n', 'utf8')))
    ]

    // When
    const ours = cases.map((bytes) => blockCid(bytes))

    // Then
    expect(ours).toEqual(cases.map((bytes) => referenceCid(bytes)))
  })

  it('round-trips a digest through the CID encoding', () => {
    // Given
    const digest = blake2b(new TextEncoder().encode('round trip'), { dkLen: 32 })

    // When
    const hex = cidToBlake2b256DigestHex(digestToCid(digest))

    // Then
    expect(hex).toBe(`0x${Buffer.from(digest).toString('hex')}`)
  })
})

describe('content addressing fails', () => {
  it('rejects a digest that is not 32 bytes', () => {
    // Given
    const digest = new Uint8Array(16)

    // When
    const encode = () => digestToCid(digest)

    // Then
    expect(encode).toThrow(/32 bytes/)
  })

  it('rejects a CID without the base32 multibase prefix', () => {
    // Given
    const cid = 'Qmfoo'

    // When
    const decode = () => cidToBlake2b256DigestHex(cid)

    // Then
    expect(decode).toThrow(/multibase/)
  })

  it('rejects a CID of the wrong length', () => {
    // Given
    const cid = 'babcdef'

    // When
    const decode = () => cidToBlake2b256DigestHex(cid)

    // Then
    expect(decode).toThrow(/expected 38/)
  })

  it('rejects a sha-256 CID, which the preimage bridge cannot resolve', () => {
    // Given
    const cid = CID.createV1(RAW_CODEC, Digest.create(0x12, new Uint8Array(32).fill(7))).toString()

    // When
    const decode = () => cidToBlake2b256DigestHex(cid)

    // Then
    expect(decode).toThrow()
  })

  // A 34-byte sha-256 digest pads the CID back out to the blake2b length.
  it('rejects a CID of the right length carrying the wrong multihash', () => {
    // Given
    const cid = CID.createV1(RAW_CODEC, Digest.create(0x12, new Uint8Array(34).fill(7))).toString()

    // When
    const decode = () => cidToBlake2b256DigestHex(cid)

    // Then
    expect(decode).toThrow(/blake2b-256/)
  })
})

describe('shard keying works', () => {
  it('takes the first two characters', () => {
    // Given
    const keys = ['alice', 'ab']

    // When
    const shards = keys.map(shardKey)

    // Then
    expect(shards).toEqual(['al', 'ab'])
  })

  it('has no shard for a key too short to be searched for', () => {
    // Given
    const keys = ['a', '']

    // When
    const shards = keys.map(shardKey)

    // Then
    expect(shards).toEqual([null, null])
  })
})

describe('lower-bound search works', () => {
  const sorted = ['ab', 'ac', 'ba', 'bb', 'bc', 'ca']

  it('finds the first entry at or after the prefix', () => {
    // Given
    const prefixes = ['ba', 'bb']

    // When
    const found = prefixes.map((prefix) => lowerBound(sorted, prefix, identity))

    // Then
    expect(found).toEqual([2, 3])
  })

  it('returns 0 when every entry sorts after the prefix', () => {
    // When
    const found = lowerBound(sorted, 'aa', identity)

    // Then
    expect(found).toBe(0)
  })

  it('returns the length when every entry sorts before the prefix', () => {
    // When
    const found = lowerBound(sorted, 'zz', identity)

    // Then
    expect(found).toBe(6)
  })

  it('handles an empty array', () => {
    // When
    const found = lowerBound([], 'aa', identity)

    // Then
    expect(found).toBe(0)
  })

  it('lands on the first of a run of equal keys', () => {
    // Given
    const run = ['aa', 'aa', 'aa']

    // When
    const found = lowerBound(run, 'aa', identity)

    // Then
    expect(found).toBe(0)
  })
})

describe('decompression works', () => {
  it('reverses gzipSync, the compression the publisher applies', async () => {
    // Given
    const text = 'alpha\nbeta\ngamma\n'
    const bytes = new Uint8Array(gzipSync(Buffer.from(text, 'utf8')))

    // When
    const decompressed = await gunzip(bytes)

    // Then
    expect(decompressed).toBe(text)
  })
})

describe('decompression fails', () => {
  it('rejects bytes that are not gzip', async () => {
    // Given
    const bytes = new TextEncoder().encode('not gzip')

    // When
    const decompressed = gunzip(bytes)

    // Then
    await expect(decompressed).rejects.toThrow()
  })
})

const MANIFEST: SnapshotManifest = {
  version: 1,
  generatedAt: 1_700_000_000_000,
  network: '0xnetwork',
  shardScheme: { prefixLen: 2, count: 1 },
  shards: { al: { cid: 'bcid', count: 3 } }
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('manifest parsing works', () => {
  it('accepts a manifest for the expected network', () => {
    // Given
    const bytes = encode(MANIFEST)

    // When
    const parsed = parseManifest(bytes, '0xnetwork')

    // Then
    expect(parsed).toEqual(MANIFEST)
  })
})

describe('manifest parsing fails', () => {
  it('rejects a manifest crawled against another network', () => {
    // Given
    const bytes = encode(MANIFEST)

    // When
    const parsed = parseManifest(bytes, '0xother')

    // Then
    expect(parsed).toBeNull()
  })

  it('rejects malformed JSON', () => {
    // Given
    const bytes = new TextEncoder().encode('{ not json')

    // When
    const parsed = parseManifest(bytes, '0xnetwork')

    // Then
    expect(parsed).toBeNull()
  })

  it('rejects an object missing required fields', () => {
    // Given
    const bytes = encode({ version: 1, network: '0xnetwork' })

    // When
    const parsed = parseManifest(bytes, '0xnetwork')

    // Then
    expect(parsed).toBeNull()
  })

  it('rejects a JSON value that is not an object', () => {
    // Given
    const cases = [encode('a string'), encode(null)]

    // When
    const parsed = cases.map((bytes) => parseManifest(bytes, '0xnetwork'))

    // Then
    expect(parsed).toEqual([null, null])
  })

  it('rejects a non-object handed straight to the shape guard', () => {
    // Given
    const cases = [null, 42, undefined]

    // When
    const guarded = cases.map(isSnapshotManifest)

    // Then
    expect(guarded).toEqual([false, false, false])
  })
})
