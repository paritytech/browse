import { bytesToHex } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { buildSnapshotBlocks } from './blocks.js'
import { cidToBlake2b256DigestHex, shardKey } from './format.js'
import {
  DOMAINS_POINTER_KEY,
  encodeTextRead,
  type NetworkProvider,
  USERNAMES_POINTER_KEY
} from './pointer.js'
import {
  DomainSnapshotService,
  type PreimageProvider,
  type SnapshotServiceOptions,
  UsernameSnapshotService
} from './service.js'

const NETWORK = '0xgenesis'

interface Snapshot {
  manifestCid: string
  blocks: Map<string, Uint8Array>
}

/**
 * Build a snapshot with the publisher itself, so these fixtures are the bytes
 * production emits rather than a second implementation that can drift from it.
 */
function buildSnapshot(lines: string[], sortKeyOf: (line: string) => string): Snapshot {
  const built = buildSnapshotBlocks({
    version: 1,
    network: NETWORK,
    lines: [...lines].sort(),
    shardKeyOf: (line) => shardKey(sortKeyOf(line)),
    generatedAt: 0
  })
  return {
    manifestCid: built.manifestCid,
    blocks: new Map(built.blocks.map((block) => [block.cid, block.data]))
  }
}

/**
 * Serve a snapshot by digest, the way a preimage bridge would.
 *
 * `lookup` reports a miss the way a bridge does, by handing back `null` and then
 * interrupting, rather than by never calling back at all.
 */
function readerFor(
  snapshot: Snapshot,
  onLookup?: (digest: `0x${string}`) => void
): PreimageProvider {
  const byDigest = new Map<string, Uint8Array>()
  for (const [cid, bytes] of snapshot.blocks) byDigest.set(cidToBlake2b256DigestHex(cid), bytes)
  return {
    lookup: (digest, onBytes) => {
      onLookup?.(digest)
      const bytes = byDigest.get(digest)
      const interrupt: { handler?: () => void } = {}
      queueMicrotask(() => {
        if (bytes) onBytes(bytes)
        else interrupt.handler?.()
      })
      return {
        unsubscribe: () => {},
        onInterrupt: (handler) => {
          interrupt.handler = handler
        }
      }
    }
  }
}

const DOMAINS = ['alpha', 'alpine', 'altitude', 'beta', 'zzautocomplete', 'zzstopwatch', 'a']
const domainSnapshot = buildSnapshot(DOMAINS, (line) => line)

const USERNAMES = [
  'alice\t5Alice',
  'alicia\t5Alicia',
  'bob\t5Bob',
  'zzautoname\t5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y'
]
const usernameSnapshot = buildSnapshot(USERNAMES, (line) => line.slice(0, line.indexOf('\t')))

const openDomains = (overrides: Partial<SnapshotServiceOptions> = {}) =>
  new DomainSnapshotService({
    preimageProvider: readerFor(domainSnapshot),
    network: NETWORK,
    manifestCid: domainSnapshot.manifestCid,
    ...overrides
  })

describe('domain suggestion works', () => {
  it('returns every label sharing the prefix, in order', async () => {
    // Given
    const service = openDomains()

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual(['alpha', 'alpine', 'altitude'])
  })

  it('narrows as the prefix grows', async () => {
    // Given
    const service = openDomains()

    // When
    const results = await service.suggest('alp')

    // Then
    expect(results).toEqual(['alpha', 'alpine'])
  })

  it('stops at the first entry that no longer matches', async () => {
    // Given
    const service = openDomains()

    // When
    const results = await service.suggest('zzs')

    // Then
    expect(results).toEqual(['zzstopwatch'])
  })

  it('clamps to maxResults', async () => {
    // Given
    const service = openDomains({ maxResults: 2 })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual(['alpha', 'alpine'])
  })
})

describe('domain suggestion fails', () => {
  it('yields nothing for a prefix shorter than a shard key', async () => {
    // Given
    const service = openDomains()

    // When
    const results = await Promise.all([service.suggest('a'), service.suggest('')])

    // Then
    expect(results).toEqual([[], []])
  })

  it('yields nothing when no shard covers the prefix', async () => {
    // Given
    const service = openDomains()

    // When
    const results = await service.suggest('qq')

    // Then
    expect(results).toEqual([])
  })

  it('yields nothing once the signal is aborted', async () => {
    // Given
    const service = openDomains()
    const controller = new AbortController()
    controller.abort()

    // When
    const results = await service.suggest('al', controller.signal)

    // Then
    expect(results).toEqual([])
  })

  it('yields nothing when the manifest is for another network', async () => {
    // Given
    const service = openDomains({ network: '0xother' })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual([])
  })

  it('yields nothing when the manifest block is unavailable', async () => {
    // Given
    const service = openDomains({ preimageProvider: () => null })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual([])
  })

  it('yields nothing when a shard block is unavailable', async () => {
    // Given
    const manifestOnly = buildSnapshot(DOMAINS, (line) => line)
    for (const cid of manifestOnly.blocks.keys()) {
      if (cid !== manifestOnly.manifestCid) manifestOnly.blocks.delete(cid)
    }
    const service = openDomains({
      preimageProvider: readerFor(manifestOnly),
      manifestCid: manifestOnly.manifestCid
    })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual([])
  })

  it('yields nothing when the CID is malformed', async () => {
    // Given
    const service = openDomains({ manifestCid: 'not-a-cid' })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual([])
  })

  it('yields nothing when no CID is configured at all', async () => {
    // Given
    const service = openDomains({ manifestCid: undefined })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual([])
  })
})

describe('block caching works', () => {
  it('reads the manifest and each shard once across many queries', async () => {
    // Given
    const onLookup = vi.fn()
    const service = openDomains({ preimageProvider: readerFor(domainSnapshot, onLookup) })

    // When
    await service.suggest('al')
    await service.suggest('alp')
    await service.suggest('alt')

    // Then
    expect(onLookup).toHaveBeenCalledTimes(2)
  })

  it('shares one read between concurrent queries on the same shard', async () => {
    // Given
    const onLookup = vi.fn()
    const service = openDomains({ preimageProvider: readerFor(domainSnapshot, onLookup) })

    // When
    await Promise.all([service.suggest('al'), service.suggest('alp'), service.suggest('alt')])

    // Then
    expect(onLookup).toHaveBeenCalledTimes(2)
  })

  it('retries a manifest that failed transiently rather than going dark', async () => {
    // Given
    const full = readerFor(domainSnapshot)
    let failNext = true
    const service = openDomains({
      preimageProvider: () => {
        if (failNext) {
          failNext = false
          return null
        }
        return full
      }
    })

    // When
    const first = await service.suggest('al')
    const second = await service.suggest('al')

    // Then
    expect(first).toEqual([])
    expect(second).toEqual(['alpha', 'alpine', 'altitude'])
  })

  it('retries a manifest whose source rejected rather than resolved null', async () => {
    // Given
    const full = readerFor(domainSnapshot)
    let failNext = true
    const service = openDomains({
      preimageProvider: () => {
        if (failNext) {
          failNext = false
          return Promise.reject(new Error('bridge blew up'))
        }
        return full
      }
    })

    // When
    const first = await service.suggest('al')
    const second = await service.suggest('al')

    // Then
    expect(first).toEqual([])
    expect(second).toEqual(['alpha', 'alpine', 'altitude'])
  })

  // A resolved CID is memoized per session, so a rotation is only picked up by a
  // fresh service. This pins that boundary.
  it('re-reads everything when the pointer moves to a new snapshot', async () => {
    // Given
    const rotated = buildSnapshot(['alpaca', 'alpha'], (line) => line)
    const blocks = new Map([...domainSnapshot.blocks, ...rotated.blocks])
    const onLookup = vi.fn()
    let current = domainSnapshot.manifestCid
    const options = {
      preimageProvider: readerFor({ manifestCid: '', blocks }, onLookup),
      network: NETWORK,
      resolveManifestCid: () => Promise.resolve(current)
    }
    const service = new DomainSnapshotService(options)

    // When
    const before = await service.suggest('al')
    current = rotated.manifestCid
    const sameService = await service.suggest('al')
    const freshService = await new DomainSnapshotService(options).suggest('al')

    // Then
    expect(before).toEqual(['alpha', 'alpine', 'altitude'])
    expect(sameService).toEqual(['alpha', 'alpine', 'altitude'])
    expect(freshService).toEqual(['alpaca', 'alpha'])
  })
})

describe('pointer resolution works', () => {
  it('resolves the manifest CID when none is pinned', async () => {
    // Given
    const service = new DomainSnapshotService({
      preimageProvider: readerFor(domainSnapshot),
      network: NETWORK,
      resolveManifestCid: () => Promise.resolve(domainSnapshot.manifestCid)
    })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual(['alpha', 'alpine', 'altitude'])
  })

  it('resolves once per session, not once per query', async () => {
    // Given
    const resolveManifestCid = vi.fn(() => Promise.resolve(domainSnapshot.manifestCid))
    const service = new DomainSnapshotService({
      preimageProvider: readerFor(domainSnapshot),
      network: NETWORK,
      resolveManifestCid
    })

    // When
    await service.suggest('al')
    await service.suggest('be')

    // Then
    expect(resolveManifestCid).toHaveBeenCalledTimes(1)
  })

  it('prefers a pinned CID over the resolver', async () => {
    // Given
    const resolveManifestCid = vi.fn(() => Promise.resolve('bshouldnotbeused'))
    const service = openDomains({ resolveManifestCid })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual(['alpha', 'alpine', 'altitude'])
    expect(resolveManifestCid).not.toHaveBeenCalled()
  })
})

describe('pointer resolution fails', () => {
  // A name whose record was never written stays unset for the session. Paying a
  // chain read per keystroke to rediscover that is the cost this pins.
  it('reads an unset record once per session, not once per keystroke', async () => {
    // Given
    const resolveManifestCid = vi.fn(() => Promise.resolve(null))
    const service = new DomainSnapshotService({
      preimageProvider: readerFor(domainSnapshot),
      network: NETWORK,
      resolveManifestCid
    })

    // When
    await service.suggest('al')
    await service.suggest('alp')
    await service.suggest('be')

    // Then
    expect(resolveManifestCid).toHaveBeenCalledTimes(1)
  })

  it('retries a lookup that failed, unlike one that came back empty', async () => {
    // Given
    const resolveManifestCid = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValue(domainSnapshot.manifestCid)
    const service = new DomainSnapshotService({
      preimageProvider: readerFor(domainSnapshot),
      network: NETWORK,
      resolveManifestCid
    })

    // When
    const first = await service.suggest('al')
    const second = await service.suggest('al')

    // Then
    expect(first).toEqual([])
    expect(second).toEqual(['alpha', 'alpine', 'altitude'])
  })

  it('yields nothing when the resolver throws', async () => {
    // Given
    const service = new DomainSnapshotService({
      preimageProvider: readerFor(domainSnapshot),
      network: NETWORK,
      resolveManifestCid: () => Promise.reject(new Error('rpc down'))
    })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual([])
  })
})

const openUsernames = () =>
  new UsernameSnapshotService({
    preimageProvider: readerFor(usernameSnapshot),
    network: NETWORK,
    manifestCid: usernameSnapshot.manifestCid
  })

describe('username suggestion works', () => {
  it('returns the username with the account that owns it', async () => {
    // Given
    const service = openUsernames()

    // When
    const results = await service.suggest('zzauto')

    // Then
    expect(results).toEqual([
      { username: 'zzautoname', account: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y' }
    ])
  })

  it('matches on the username, not the whole line', async () => {
    // Given
    const service = openUsernames()

    // When
    const results = await service.suggest('ali')

    // Then
    expect(results).toEqual([
      { username: 'alice', account: '5Alice' },
      { username: 'alicia', account: '5Alicia' }
    ])
  })

  it('skips lines with no separator', async () => {
    // Given
    const malformed = buildSnapshot(['abc', 'abd\t5Abd', '\t5Empty'], (line) => {
      const tab = line.indexOf('\t')
      return tab > 0 ? line.slice(0, tab) : line
    })
    const service = new UsernameSnapshotService({
      preimageProvider: readerFor(malformed),
      network: NETWORK,
      manifestCid: malformed.manifestCid
    })

    // When
    const results = await service.suggest('ab')

    // Then
    expect(results).toEqual([{ username: 'abd', account: '5Abd' }])
  })
})

const POINTER_NAME = 'browse.dot'

/** Capture the calldata each service asks the content resolver for. */
function recordingPointer() {
  const calls: string[] = []
  const networkProvider: NetworkProvider = {
    apis: {
      ReviveApi: {
        call: (_origin, _dest, _value, _weight, _deposit, inputData) => {
          calls.push(bytesToHex(inputData))
          return Promise.reject(new Error('no record set'))
        }
      }
    }
  }
  return {
    calls,
    networkProvider,
    pointer: {
      contentResolver: '0x0000000000000000000000000000000000000001' as const,
      domain: POINTER_NAME
    }
  }
}

describe('pointer record selection works', () => {
  // Pinning the exact calldata matters. Asserting only that the two differ would
  // still pass with the keys swapped, each service reading the other dataset.
  it('asks for exactly its own record', async () => {
    // Given
    const domains = recordingPointer()
    const usernames = recordingPointer()

    // When
    await new DomainSnapshotService({
      preimageProvider: () => null,
      network: NETWORK,
      networkProvider: domains.networkProvider,
      pointer: domains.pointer
    }).suggest('al')
    await new UsernameSnapshotService({
      preimageProvider: () => null,
      network: NETWORK,
      networkProvider: usernames.networkProvider,
      pointer: usernames.pointer
    }).suggest('al')

    // Then
    expect(domains.calls).toEqual([encodeTextRead(POINTER_NAME, DOMAINS_POINTER_KEY)])
    expect(usernames.calls).toEqual([encodeTextRead(POINTER_NAME, USERNAMES_POINTER_KEY)])
  })
})

describe('pointer record selection fails', () => {
  it('yields nothing when the record is unreadable', async () => {
    // Given
    const { networkProvider, pointer } = recordingPointer()
    const service = new DomainSnapshotService({
      preimageProvider: readerFor(domainSnapshot),
      network: NETWORK,
      networkProvider,
      pointer
    })

    // When
    const results = await service.suggest('al')

    // Then
    expect(results).toEqual([])
  })
})
