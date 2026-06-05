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

import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider'
import { AccountId, Binary, createClient, type PolkadotClient, type SS58String } from 'polkadot-api'

import { decodeBytes, decodeString } from './abi/codec.js'
import { decodeIpfsContenthash } from './abi/contenthash.js'
import {
  encodeContenthash,
  encodeGetPublished,
  encodeLabelOf,
  encodeText
} from './abi/contracts.js'
import {
  type AggregateResult,
  decodeAggregate3Result,
  encodeAggregate3,
  type MulticallTarget,
  tryDecode
} from './abi/multicall.js'
import { labelhashToTokenId, namehash } from './abi/namehash.js'
import { decodeBytes32Array } from './abi/codec.js'
import type { NetworkConfig } from './config.js'
import { parseRootManifest } from './manifest.js'
import type { AppListing, Modality } from './types.js'

type EncodedBytes = ReturnType<typeof Binary.fromHex>

/** Pallet-revive's `AccountId32Mapper` derives an AccountId32 from an H160 by
 *  padding with 12 bytes of 0xee. Such accounts are implicitly mapped, so we
 *  can use one as the caller for view-only dry-runs without depending on any
 *  specific account being explicitly mapped via `Revive.map_account`. */
const DUMMY_ORIGIN: SS58String = (() => {
  const bytes = new Uint8Array(32).fill(0xee)
  bytes.set(new Uint8Array(20), 0) // H160(0x00…00) in the low 20 bytes
  return AccountId().dec(bytes) as SS58String
})()

const DRY_RUN_GAS_LIMIT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n
} as const
const DRY_RUN_STORAGE_LIMIT = 18_446_744_073_709_551_615n
const MULTICALL_CHUNK_SIZE = 30
const PUBLISHER_PAGE_LIMIT = 1000n
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Minimum duck-typed shape of `client.getUnsafeApi().apis.ReviveApi`.
 *  `getUnsafeApi` resolves the call at runtime against on-chain metadata, so
 *  we don't need to import or ship the chain descriptors. */
interface ReviveApi {
  apis: {
    ReviveApi: {
      call: (
        origin: SS58String,
        target: `0x${string}`,
        value: bigint,
        gasLimit: { ref_time: bigint; proof_size: bigint },
        storageDepositLimit: bigint,
        data: EncodedBytes,
        options?: { at?: string }
      ) => Promise<{
        result:
          | { success: true; value: { flags: number; data: EncodedBytes } }
          | { success: false; value: unknown }
      }>
    }
  }
}

/**
 * High-level entry point for browse queries against a configured network.
 *
 * Accepts any papi-compatible {@link JsonRpcProvider}: host-sdk's
 * `createPapiProvider`, polkadot-api's `getWsProvider`, a smoldot light-client
 * provider, etc. The underlying client is created lazily on the first query
 * and torn down via {@link destroy}.
 */
export class BrowseSdk {
  #client: PolkadotClient | null = null

  constructor(
    public readonly network: NetworkConfig,
    private readonly provider: JsonRpcProvider
  ) {}

  /** Lazily-created polkadot-api client bound to the configured provider. */
  getClient(): PolkadotClient {
    this.#client ??= createClient(this.provider)
    return this.#client
  }

  /** Dry-run a contract read via `ReviveApi.call` and return the raw hex output. */
  async reviveCall(
    target: `0x${string}`,
    data: `0x${string}`,
    origin: SS58String = DUMMY_ORIGIN
  ): Promise<`0x${string}`> {
    const api = this.getClient().getUnsafeApi() as unknown as ReviveApi
    const res = await api.apis.ReviveApi.call(
      origin,
      target,
      0n,
      DRY_RUN_GAS_LIMIT,
      DRY_RUN_STORAGE_LIMIT,
      Binary.fromHex(data),
      { at: 'best' }
    )
    if (!res.result.success) throw new Error('Revive call failed')
    const { flags, data: ret } = res.result.value
    if ((flags & 1) === 1) throw new Error('Contract execution reverted')
    return Binary.toHex(ret) as `0x${string}`
  }

  /**
   * Execute batched contract reads via `Multicall3.aggregate3`.
   *
   * Each call has `allowFailure=true`. Failed sub-calls surface as
   * `{ success: false }`. Inputs larger than the chunk size are split across
   * multiple batches transparently.
   */
  async multicall(calls: MulticallTarget[]): Promise<AggregateResult[]> {
    const out: AggregateResult[] = []
    for (let i = 0; i < calls.length; i += MULTICALL_CHUNK_SIZE) {
      const batch = calls.slice(i, i + MULTICALL_CHUNK_SIZE)
      const ret = await this.reviveCall(this.network.MULTICALL3, encodeAggregate3(batch))
      out.push(...decodeAggregate3Result(ret))
    }
    return out
  }

  /**
   * Paginated read of `Publisher.getPublished` returning every published
   * labelhash. Returns `[]` immediately on networks without a Publisher
   * (`PUBLISHER === ZERO_ADDRESS`).
   */
  async listPublishedLabelhashes(): Promise<`0x${string}`[]> {
    if (this.network.PUBLISHER === ZERO_ADDRESS) return []
    const all: `0x${string}`[] = []
    let offset = 0n
    for (;;) {
      const ret = await this.reviveCall(
        this.network.PUBLISHER,
        encodeGetPublished(offset, PUBLISHER_PAGE_LIMIT)
      )
      const page = decodeBytes32Array(ret)
      all.push(...page)
      if (page.length < Number(PUBLISHER_PAGE_LIMIT)) break
      offset += PUBLISHER_PAGE_LIMIT
    }
    return all
  }

  /** Resolve labelhashes to string labels via `Registrar.labelOf`. */
  async resolveLabels(labelhashes: `0x${string}`[]): Promise<string[]> {
    const calls: MulticallTarget[] = labelhashes.map((lh) => ({
      target: this.network.REGISTRAR,
      callData: encodeLabelOf(labelhashToTokenId(lh))
    }))
    const results = await this.multicall(calls)
    const out: string[] = []
    for (let i = 0; i < labelhashes.length; i++) {
      const name = tryDecode(results[i], decodeString)
      if (name) out.push(name)
    }
    return out
  }

  /**
   * Hydrate each label into an {@link AppListing}.
   *
   * Two-pass multicall: `contenthash` first (drops non-live labels), then
   * the `manifest` text record for the survivors. Returned in input order;
   * labels with an unparseable manifest are skipped.
   */
  async hydrateApps(labels: string[]): Promise<AppListing[]> {
    if (labels.length === 0) return []

    const chCalls: MulticallTarget[] = labels.map((label) => ({
      target: this.network.CONTENT_RESOLVER,
      callData: encodeContenthash(namehash(`${label}.dot`))
    }))
    const chResults = await this.multicall(chCalls)
    const contentHashes = labels.map((_, i) =>
      tryDecode(chResults[i], (data) => decodeIpfsContenthash(decodeBytes(data)))
    )

    const liveIndexes: number[] = []
    for (let i = 0; i < labels.length; i++) if (contentHashes[i]) liveIndexes.push(i)
    if (liveIndexes.length === 0) return []

    const manifestCalls: MulticallTarget[] = liveIndexes.map((i) => ({
      target: this.network.CONTENT_RESOLVER,
      callData: encodeText(namehash(`${labels[i]}.dot`), 'manifest')
    }))
    const manifestResults = await this.multicall(manifestCalls)

    const apps: AppListing[] = []
    for (let j = 0; j < liveIndexes.length; j++) {
      const i = liveIndexes[j] as number
      const raw = tryDecode(manifestResults[j], decodeString) ?? ''
      const manifest = parseRootManifest(raw)
      const cid = contentHashes[i]
      const label = labels[i]
      if (!manifest || !cid || !label) continue
      apps.push({ label, contentHash: cid, manifest })
    }
    return apps
  }

  /**
   * Return every published app for which a modality-specific subname carries
   * content. The convention is `<modality>.<label>.dot`.
   *
   * `app` reads `app.<label>.dot` (the SPA bundle). `widget` reads
   * `widget.<label>.dot` (the embeddable widget). `worker` reads
   * `worker.<label>.dot` (the worker bundle).
   *
   * Labels whose modality subname has no contenthash are excluded. The
   * returned `AppListing.contentHash` is the modality-specific CID, not the
   * bare label's.
   */
  async listAppsByModality(modality: Modality): Promise<AppListing[]> {
    const labelhashes = await this.listPublishedLabelhashes()
    if (labelhashes.length === 0) return []
    const labels = await this.resolveLabels(labelhashes)
    if (labels.length === 0) return []

    const modalityCalls: MulticallTarget[] = labels.map((label) => ({
      target: this.network.CONTENT_RESOLVER,
      callData: encodeContenthash(namehash(`${modality}.${label}.dot`))
    }))
    const modalityResults = await this.multicall(modalityCalls)
    const modalityCids = labels.map((_, i) =>
      tryDecode(modalityResults[i], (data) => decodeIpfsContenthash(decodeBytes(data)))
    )

    const liveIndexes: number[] = []
    for (let i = 0; i < labels.length; i++) if (modalityCids[i]) liveIndexes.push(i)
    if (liveIndexes.length === 0) return []

    const manifestCalls: MulticallTarget[] = liveIndexes.map((i) => ({
      target: this.network.CONTENT_RESOLVER,
      callData: encodeText(namehash(`${labels[i]}.dot`), 'manifest')
    }))
    const manifestResults = await this.multicall(manifestCalls)

    const apps: AppListing[] = []
    for (let j = 0; j < liveIndexes.length; j++) {
      const i = liveIndexes[j] as number
      const raw = tryDecode(manifestResults[j], decodeString) ?? ''
      const manifest = parseRootManifest(raw)
      const cid = modalityCids[i]
      const label = labels[i]
      if (!manifest || !cid || !label) continue
      apps.push({ label, contentHash: cid, manifest })
    }
    return apps
  }

  /** Tear down the underlying client. Safe to call multiple times. */
  destroy(): void {
    this.#client?.destroy()
    this.#client = null
  }
}

/** Convenience factory: equivalent to `new BrowseSdk(network, provider)`. */
export function createBrowseSdk(network: NetworkConfig, provider: JsonRpcProvider): BrowseSdk {
  return new BrowseSdk(network, provider)
}
