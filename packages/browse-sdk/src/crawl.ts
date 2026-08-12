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
 * Producers of the snapshot line sets.
 *
 * These enumerate whole datasets, which is why they run as a scheduled job and
 * not in a client. Each returns sorted lines ready for {@link publishSnapshot}.
 * Sorting is the load-bearing part. The reader binary-searches shards and stops
 * at the first non-matching entry, so unsorted input silently truncates results.
 *
 * Both use `getUnsafeApi`, which resolves storage and runtime calls against
 * metadata at runtime, so this package ships no chain descriptors.
 */

import { decodeAddress, decodeAddressArray, decodeBytes, decodeStringArray } from './abi/codec.js'
import { decodeIpfsContenthash } from './abi/contenthash.js'
import {
  encodeContenthash,
  encodeGetLabels,
  encodeGetLabelStores,
  encodeOwner
} from './abi/contracts.js'
import { type MulticallTarget, tryDecode } from './abi/multicall.js'
import { namehash } from './abi/namehash.js'
import { nameWithTld, stripTld } from './name.js'
import type { BrowseSdk } from './sdk.js'
import type { PolkadotClient } from 'polkadot-api'

const STORE_FACTORY_PAGE_LIMIT = 1000n
const LABEL_STORE_PAGE_LIMIT = 1000n
const CONTENT_CHUNK = 200

/** How many stores to read at once. Sized to be polite to a single public RPC. */
const STORE_CONCURRENCY = 8

/** Progress callback, so a CLI can report without this module owning output. */
export type CrawlProgress = (message: string) => void

const noop: CrawlProgress = () => {}

/** Minimum shape of the storage reads {@link crawlUsernames} performs. */
interface UsernameStorageApi {
  query: {
    Resources: {
      UsernameOwnerOf: {
        getEntries: () => Promise<{ keyArgs: [Uint8Array]; value: string }[]>
      }
    }
  }
}

/** Minimum shape of the storage reads {@link crawlDomains} performs. */
interface OriginalAccountApi {
  query: {
    Revive: {
      OriginalAccount: {
        getValue: (h160: `0x${string}`) => Promise<{ toString?: () => string } | undefined>
      }
    }
  }
}

/** Strip a trailing network TLD and lowercase, rejecting subnames. */
function normalizeLabel(raw: string, tld: string): string | null {
  if (!raw) return null
  const bare = stripTld(raw, tld)
  if (!bare || bare.includes('.')) return null
  return bare
}

/** Sort lines by code unit, the order the reader binary search assumes. */
function sortLines(lines: string[]): string[] {
  return lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Map a contract address to the account that deployed it, for authenticated reads. */
async function lookupOriginalAccount(sdk: BrowseSdk, h160: string): Promise<string | null> {
  try {
    const api = sdk.getClient().getUnsafeApi() as unknown as OriginalAccountApi
    const h160Hex = (h160.startsWith('0x') ? h160 : `0x${h160}`) as `0x${string}`
    const mapped = await api.query.Revive.OriginalAccount.getValue(h160Hex)
    return mapped?.toString?.() ?? null
  } catch {
    return null
  }
}

/** Every label registered across every LabelStore the factory has deployed. */
async function crawlViaStores(sdk: BrowseSdk, progress: CrawlProgress): Promise<string[]> {
  const network = sdk.network
  const storeAddresses: `0x${string}`[] = []
  for (let offset = 0n; ; offset += STORE_FACTORY_PAGE_LIMIT) {
    const raw = await sdk.reviveCall(
      network.STORE_FACTORY,
      encodeGetLabelStores(offset, STORE_FACTORY_PAGE_LIMIT)
    )
    const page = decodeAddressArray(raw)
    for (const address of page) storeAddresses.push(address.toLowerCase() as `0x${string}`)
    if (page.length < Number(STORE_FACTORY_PAGE_LIMIT)) break
  }
  progress(`stores:    ${storeAddresses.length} LabelStore(s)`)
  if (storeAddresses.length === 0) return []

  const ownerResults = await sdk.multicall(
    storeAddresses.map((address) => ({
      target: address,
      callData: encodeOwner()
    }))
  )
  const ownerAddresses = ownerResults.map((result) =>
    tryDecode(result, (data) => decodeAddress(data).toLowerCase())
  )

  const seen = new Set<string>()
  let scanned = 0

  /** Every label held by one store, read as its owner. */
  const readStore = async (index: number): Promise<string[]> => {
    // getLabels is owner-scoped, so read as the owner where we can resolve one.
    // Otherwise fall through to the implicitly-mapped origin reviveCall defaults
    // to, which a gated store rejects and the catch below skips.
    const owner = ownerAddresses[index]
      ? await lookupOriginalAccount(sdk, ownerAddresses[index]!)
      : null
    const labels: string[] = []
    for (let offset = 0n; ; offset += LABEL_STORE_PAGE_LIMIT) {
      let page: string[]
      try {
        const raw = await sdk.reviveCall(
          storeAddresses[index]!,
          encodeGetLabels(offset, LABEL_STORE_PAGE_LIMIT),
          owner ?? undefined
        )
        page = decodeStringArray(raw)
      } catch {
        break
      }
      labels.push(...page)
      if (page.length < Number(LABEL_STORE_PAGE_LIMIT)) break
    }
    return labels
  }

  // Stores are independent, so read several at once. Kept to a modest width
  // because these are dry-run calls against one public RPC, which throttles.
  for (let i = 0; i < storeAddresses.length; i += STORE_CONCURRENCY) {
    const window = storeAddresses.slice(i, i + STORE_CONCURRENCY)
    const pages = await Promise.all(window.map((_, offset) => readStore(i + offset)))
    for (const page of pages) {
      for (const rawLabel of page) {
        const bare = normalizeLabel(rawLabel, network.TLD)
        if (bare) seen.add(bare)
      }
    }
    scanned += window.length
    progress(`  scanned ${scanned}/${storeAddresses.length} stores, ${seen.size} labels`)
  }
  return [...seen]
}

/** Keep only labels that resolve to content, dropping registered but empty names. */
async function filterToLive(
  sdk: BrowseSdk,
  labels: string[],
  progress: CrawlProgress
): Promise<string[]> {
  const network = sdk.network
  const live: string[] = []
  for (let i = 0; i < labels.length; i += CONTENT_CHUNK) {
    const batch = labels.slice(i, i + CONTENT_CHUNK)
    const calls: MulticallTarget[] = batch.map((label) => ({
      target: network.CONTENT_RESOLVER,
      callData: encodeContenthash(namehash(nameWithTld(label, network.TLD)))
    }))
    const results = await sdk.multicall(calls)
    batch.forEach((label, j) => {
      const cid = tryDecode(results[j], (data) => decodeIpfsContenthash(decodeBytes(data)))
      if (cid) live.push(label)
    })
    progress(
      `  content-checked ${Math.min(i + CONTENT_CHUNK, labels.length)}/${labels.length}, ${live.length} live`
    )
  }
  return live
}

/**
 * Every registered label that currently resolves to content, sorted.
 *
 * Enumerates the LabelStore contracts the factory has deployed, reads the labels
 * out of each, then keeps the ones with a content hash. Lines are bare labels
 * with no TLD suffix.
 */
export async function crawlDomains(
  sdk: BrowseSdk,
  progress: CrawlProgress = noop
): Promise<string[]> {
  const labels = await crawlViaStores(sdk, progress)
  progress(`\nfiltering ${labels.length} labels to those with a content hash…`)
  return sortLines(await filterToLive(sdk, labels, progress))
}

/**
 * Every registered username with its owning account, sorted, as
 * `username\taccount` lines.
 *
 * Reads the People chain `Resources.UsernameOwnerOf` map, which is the registry
 * of usernames. Lines containing a tab or newline are dropped because they would
 * corrupt the framing.
 */
export async function crawlUsernames(peopleClient: PolkadotClient): Promise<string[]> {
  const api = peopleClient.getUnsafeApi() as unknown as UsernameStorageApi
  const entries = await api.query.Resources.UsernameOwnerOf.getEntries()
  const decoder = new TextDecoder()
  const lines: string[] = []
  for (const { keyArgs, value } of entries) {
    const username = decoder.decode(keyArgs[0]).toLowerCase()
    if (!username || username.includes('\t') || username.includes('\n')) continue
    lines.push(`${username}\t${value}`)
  }
  // A tab sorts below every character a username can contain, so ordering the
  // lines orders them by username.
  return sortLines(lines)
}
