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
 * Prefix search over a published snapshot.
 *
 * One manifest lookup resolves the shard set. One shard lookup covers every
 * query sharing a two-character prefix. Within a shard the lines are sorted, so
 * a binary search finds the first match and the walk stops at the first entry
 * that no longer matches. Two block reads answer a whole typing session.
 *
 * Every failure path returns no suggestions rather than throwing. Autocomplete
 * that disappears is recoverable. Autocomplete that throws into render is not.
 *
 * {@link SnapshotService} holds all of that. A subclass supplies only what makes
 * its dataset different: which text record points at it, how a line sorts, and
 * how a line becomes an entry.
 */

import {
  cidToBlake2b256DigestHex,
  gunzip,
  lowerBound,
  MIN_PREFIX_LENGTH,
  parseManifest,
  type SnapshotManifest
} from './format.js'
import {
  DOMAINS_POINTER_KEY,
  getSnapshotPointer,
  type NetworkProviderSource,
  USERNAMES_POINTER_KEY
} from './pointer.js'

/** Cancellable lookup, the shape `PreimageProvider.lookup` returns. */
export interface PreimageSubscription {
  unsubscribe: () => void
  onInterrupt: (handler: () => void) => void
}

/**
 * Serves a block by the blake2b-256 digest its CID carries.
 *
 * Anything that reaches Bulletin satisfies it, whether over a preimage bridge or
 * a direct connection. Whatever provides it must only return bytes that hash to
 * the requested digest, because that is what makes the CID the integrity check.
 */
export interface PreimageProvider {
  lookup: (key: `0x${string}`, onBytes: (bytes: Uint8Array | null) => void) => PreimageSubscription
}

/**
 * Supplies the preimage provider, either directly or through an accessor.
 *
 * The accessor exists because a client that has to negotiate for one resolves it
 * asynchronously and may not get it. A `null` result means no source is
 * available, and suggestions close rather than throw.
 */
export type PreimageProviderSource =
  PreimageProvider | (() => PreimageProvider | null | Promise<PreimageProvider | null>)

const DEFAULT_MAX_RESULTS = 8
const DEFAULT_LOOKUP_TIMEOUT_MS = 8_000

/** Where to read the manifest CID when it is not pinned. */
export interface SnapshotPointer {
  contentResolver: `0x${string}`
  /** Name carrying the record, for instance `browse.dot`. */
  domain: string
}

export interface SnapshotServiceOptions {
  /** Where blocks come from. */
  preimageProvider: PreimageProviderSource
  /** Genesis hash to accept. A snapshot crawled against another network is ignored. */
  network: string
  /** How long to wait for one block before giving up. Defaults to 8 seconds. */
  lookupTimeoutMs?: number | undefined
  /** Manifest CID to pin, which beats both ways of resolving one. */
  manifestCid?: string | undefined
  /** Reads the manifest CID from the text record this dataset publishes to. */
  networkProvider?: NetworkProviderSource | undefined
  /** Which record to read, needed alongside {@link networkProvider}. */
  pointer?: SnapshotPointer | undefined
  /**
   * Resolves the manifest CID some other way, for a client that distributes it
   * outside the chain. Beats {@link pointer} when both are given.
   */
  resolveManifestCid?: (() => Promise<string | null>) | undefined
  maxResults?: number | undefined
}

/**
 * One snapshot dataset, opened for prefix search.
 *
 * Holds the manifest and every shard it has read for the lifetime of the
 * instance. Create one per dataset and keep it.
 */
export abstract class SnapshotService<T> {
  #manifest: Promise<SnapshotManifest | null> | null = null
  #manifestCid: string | undefined
  #pointer: Promise<string | null> | null = null
  #shards = new Map<string, Promise<string[]>>()

  constructor(protected readonly options: SnapshotServiceOptions) {}

  /** Text record holding this dataset manifest CID. */
  protected abstract readonly pointerKey: string

  /** The part of a raw line the shard is sorted by. */
  protected abstract sortKeyOf(line: string): string

  /** Turns one matched line into an entry, or `null` to skip a malformed one. */
  protected abstract parseLine(line: string): T | null

  /**
   * Entries whose sort key starts with `prefix`, in sorted order.
   *
   * `prefix` must already be normalized the same way the publisher normalized
   * the data, which for both built-in datasets means lowercased. Yields nothing
   * for a prefix shorter than {@link MIN_PREFIX_LENGTH}, since a shard cannot be
   * selected from it.
   */
  async suggest(prefix: string, signal?: AbortSignal): Promise<T[]> {
    if (prefix.length < MIN_PREFIX_LENGTH) return []
    try {
      const manifest = await this.#loadManifest()
      if (!manifest || signal?.aborted) return []

      const shard = manifest.shards[prefix.slice(0, manifest.shardScheme.prefixLen)]
      if (!shard) return []

      const lines = await this.#loadShard(shard.cid)
      if (signal?.aborted) return []

      // Parse only what is returned. A shard can hold thousands of lines and at
      // most `limit` of them are ever handed back.
      const limit = this.options.maxResults ?? DEFAULT_MAX_RESULTS
      const out: T[] = []
      for (
        let i = lowerBound(lines, prefix, (line) => this.sortKeyOf(line));
        i < lines.length;
        i++
      ) {
        if (out.length >= limit) break
        if (!this.sortKeyOf(lines[i]!).startsWith(prefix)) break
        const entry = this.parseLine(lines[i]!)
        if (entry !== null) out.push(entry)
      }
      return out
    } catch {
      return []
    }
  }

  /**
   * Manifest CID to read, from the pinned value or the pointer record.
   *
   * The lookup is memoized so a typing session pins one snapshot instead of
   * paying a chain read per keystroke. An empty record is memoized too, since a
   * name whose record was never written stays that way for the session. Only a
   * failed lookup is retried.
   */
  async #currentCid(): Promise<string | null> {
    if (this.options.manifestCid) return this.options.manifestCid
    const resolve = this.#cidResolver()
    if (!resolve) return null
    if (!this.#pointer) {
      this.#pointer = resolve()
      void this.#pointer.catch(() => {
        this.#pointer = null
      })
    }
    try {
      return await this.#pointer
    } catch {
      return null
    }
  }

  /** The configured way to find the current CID, if there is one. */
  #cidResolver(): (() => Promise<string | null>) | null {
    const { resolveManifestCid, networkProvider, pointer } = this.options
    if (resolveManifestCid) return resolveManifestCid
    if (!networkProvider || !pointer) return null
    return async () => {
      const chain =
        typeof networkProvider === 'function' ? await networkProvider() : networkProvider
      if (!chain) return null
      return getSnapshotPointer(chain, pointer.contentResolver, pointer.domain, this.pointerKey)
    }
  }

  /**
   * Load and validate the manifest, memoized per CID on success only.
   *
   * A new CID invalidates the shard cache with it. A transient failure is left
   * uncached so the next query retries instead of the session going dark.
   */
  async #loadManifest(): Promise<SnapshotManifest | null> {
    const cid = await this.#currentCid()
    if (!cid) return null
    if (this.#manifestCid !== cid) {
      this.#manifest = null
      this.#shards.clear()
      this.#manifestCid = cid
    }
    if (!this.#manifest) {
      const pending = (async () => {
        const bytes = await this.#readCid(cid)
        return bytes ? parseManifest(bytes, this.options.network) : null
      })()
      // Forget anything that did not yield a manifest, a rejection included. A
      // A block read is free to reject rather than resolve null, and memoizing
      // that would leave the instance returning nothing for the rest of the
      // session. Swallow the rejection here so it never surfaces unhandled.
      this.#manifest = pending.catch(() => null)
      void this.#manifest.then((manifest) => {
        if (!manifest) this.#manifest = null
      })
    }
    return this.#manifest
  }

  /**
   * Read and decompress a shard into its raw lines, keyed by its immutable CID
   * so concurrent callers share one lookup.
   */
  #loadShard(cid: string): Promise<string[]> {
    const cached = this.#shards.get(cid)
    if (cached) return cached
    const pending = (async () => {
      const bytes = await this.#readCid(cid)
      if (!bytes) throw new Error(`Shard block unavailable: ${cid}`)
      const text = await gunzip(bytes)
      return text.split('\n').filter((line) => line.length > 0)
    })()
    pending.catch(() => this.#shards.delete(cid))
    this.#shards.set(cid, pending)
    return pending
  }

  /** Resolve a block by CID, treating a malformed CID as unavailable. */
  async #readCid(cid: string): Promise<Uint8Array | null> {
    let digest: `0x${string}`
    try {
      digest = cidToBlake2b256DigestHex(cid)
    } catch {
      return null
    }
    return this.#readBlock(digest)
  }

  /**
   * Read one block, or `null` when no source can produce it in time.
   *
   * A preimage manager answers immediately with `null` while it is still
   * fetching, then calls back again with the bytes. Only real bytes, an
   * interrupt, or the timeout settle the lookup.
   */
  #readBlock(digest: `0x${string}`): Promise<Uint8Array | null> {
    const timeoutMs = this.options.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS
    const { preimageProvider } = this.options
    return new Promise((resolve) => {
      let done = false
      let subscription: PreimageSubscription | undefined
      const settle = (bytes: Uint8Array | null) => {
        if (done) return
        done = true
        clearTimeout(timer)
        subscription?.unsubscribe()
        resolve(bytes)
      }
      void Promise.resolve(
        typeof preimageProvider === 'function' ? preimageProvider() : preimageProvider
      )
        .then((manager) => {
          if (done) return
          if (!manager) {
            settle(null)
            return
          }
          subscription = manager.lookup(digest, (bytes) => {
            if (bytes) settle(new Uint8Array(bytes))
          })
          subscription.onInterrupt(() => settle(null))
        })
        .catch(() => settle(null))
      const timer = setTimeout(() => settle(null), timeoutMs)
    })
  }
}

/**
 * Prefix search over registered `.dot` names.
 *
 * Shard lines are bare labels with no `.dot` suffix, so a suggestion is ready to
 * display as typed.
 */
export class DomainSnapshotService extends SnapshotService<string> {
  protected readonly pointerKey = DOMAINS_POINTER_KEY

  protected sortKeyOf(line: string): string {
    return line
  }

  protected parseLine(line: string): string {
    return line
  }
}

/** A username and the account that owns it. */
export interface UsernameEntry {
  username: string
  account: string
}

/**
 * Prefix search over registered usernames.
 *
 * Shard lines are `username\taccount`, so a selected suggestion carries its
 * owner and needs no further lookup. A tab sorts below every character a
 * username can contain, so ordering the lines orders them by username.
 */
export class UsernameSnapshotService extends SnapshotService<UsernameEntry> {
  protected readonly pointerKey = USERNAMES_POINTER_KEY

  /**
   * A line with no tab sorts by its whole text and parses to `null`, so a
   * malformed entry is skipped rather than ending the walk early.
   */
  protected sortKeyOf(line: string): string {
    const tab = line.indexOf('\t')
    return tab > 0 ? line.slice(0, tab) : line
  }

  protected parseLine(line: string): UsernameEntry | null {
    const tab = line.indexOf('\t')
    if (tab <= 0) return null
    return { username: line.slice(0, tab), account: line.slice(tab + 1) }
  }
}
