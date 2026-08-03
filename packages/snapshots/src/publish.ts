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
 * Publishing side of a snapshot.
 *
 * Shards the lines, gzips each shard, stores every block on Bulletin, then
 * records the manifest CID in a text record so clients can find it. Publishing
 * and pointing are separate calls because they touch different chains. Bulletin
 * storage is paid by a pool derived from the mnemonic, while the record can only
 * be written by the root account, which is the one that owns the name.
 */

import { ApiPromise, WsProvider } from '@polkadot/api'
import { encodeTextWrite } from './pointer.js'
import { sr25519CreateDerive } from '@polkadot-labs/hdkd'
import { entropyToMiniSecret, mnemonicToEntropy, ss58Address } from '@polkadot-labs/hdkd-helpers'
import { Binary, createClient, Enum, type PolkadotSigner, type SS58String } from 'polkadot-api'
import { getPolkadotSigner } from 'polkadot-api/signer'
import { getWsProvider } from 'polkadot-api/ws'

import { buildSnapshotBlocks, type SnapshotBlock } from './blocks.js'
import { RAW_CODEC } from './format.js'

const POOL_SIZE = 10
const POOL_PREFIX = '//deploy'

/** Weight and deposit ceilings for a dry-run, which measures rather than spends. */
const UNLIMITED_WEIGHT = {
  ref_time: 18_446_744_073_709_551_615n,
  proof_size: 18_446_744_073_709_551_615n
} as const
const UNLIMITED_DEPOSIT = 18_446_744_073_709_551_615n

/** Progress callback, so a caller can report without this module owning output. */
export type PublishProgress = (message: string) => void

/** The papi wrapper for raw bytes, which has no exported type of its own. */
type EncodedBytes = ReturnType<typeof Binary.fromHex>

const noop: PublishProgress = () => {}

/** How many times to submit the pointer record before giving up. */
const POINTER_ATTEMPTS = 3
const POINTER_RETRY_MS = 2_000

/** Watchable transaction, the shape `signSubmitAndWatch` returns events for. */
interface SubmittableTx {
  signSubmitAndWatch: (
    signer: ReturnType<typeof getPolkadotSigner>,
    options?: {
      mortality?: { mortal: boolean; period: number }
      nonce?: number
    }
  ) => {
    subscribe: (observer: {
      next: (event: { type: string; found?: unknown; ok?: boolean }) => void
      error: (error: unknown) => void
    }) => { unsubscribe: () => void }
  }
}

/** Minimum shape of the Bulletin storage extrinsic. */
interface BulletinApi {
  tx: {
    TransactionStorage: {
      store_with_cid_config: (args: {
        cid: { codec: bigint; hashing: unknown }
        data: Uint8Array
      }) => SubmittableTx
    }
  }
}

/**
 * Store every block on Bulletin, draining each pool account sequentially with
 * all accounts in parallel.
 *
 * Each account confirms a nonce by block inclusion before advancing. A stale
 * nonce is retried after re-reading the pool-aware next index.
 */
async function storeBlocks(
  mnemonic: string,
  blocks: SnapshotBlock[],
  bulletinRpc: string,
  progress: PublishProgress
): Promise<void> {
  const client = createClient(getWsProvider(bulletinRpc))
  const api = client.getUnsafeApi() as unknown as BulletinApi
  const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(mnemonic)))

  // Pool-aware next nonce that accounts for in-flight pool txs. papi reads
  // finalized, so use the @polkadot/api `system_accountNextIndex` RPC.
  const pjs = await ApiPromise.create({
    provider: new WsProvider(bulletinRpc),
    noInitWarn: true
  })
  const pool = await Promise.all(
    Array.from({ length: POOL_SIZE }, async (_, i) => {
      const keypair = derive(`${POOL_PREFIX}/${i}`)
      const address = ss58Address(keypair.publicKey)
      return {
        signer: getPolkadotSigner(keypair.publicKey, 'Sr25519', keypair.sign),
        address,
        nonce: (await pjs.rpc.system.accountNextIndex(address)).toNumber()
      }
    })
  )
  progress(`pool:      ${POOL_SIZE} signers (${pool[0]!.address.slice(0, 8)}…)\n`)

  const submit = (
    block: SnapshotBlock,
    signer: ReturnType<typeof getPolkadotSigner>,
    nonce: number
  ) =>
    new Promise<void>((resolve, reject) => {
      const tx = api.tx.TransactionStorage.store_with_cid_config({
        cid: { codec: BigInt(RAW_CODEC), hashing: Enum('Blake2b256') },
        data: block.data
      })
      const sub = tx
        .signSubmitAndWatch(signer, {
          mortality: { mortal: true, period: 64 },
          nonce
        })
        .subscribe({
          next: (event: { type: string; found?: unknown; ok?: boolean }) => {
            if (event.type === 'txBestBlocksState' && event.found) {
              sub.unsubscribe()
              if (event.ok) resolve()
              else reject(new Error('tx failed in block'))
            }
          },
          error: (error: unknown) => reject(error)
        })
    })

  const isStale = (error: unknown) =>
    JSON.stringify((error as Error)?.message ?? error ?? '').includes('Stale')

  let done = 0
  await Promise.all(
    pool.map(async (account, accountIndex) => {
      let nonce = account.nonce
      for (let index = accountIndex; index < blocks.length; index += POOL_SIZE) {
        for (let attempt = 0; ; attempt++) {
          try {
            await submit(blocks[index]!, account.signer, nonce)
            nonce++
            break
          } catch (error) {
            if (isStale(error) && attempt < 8) {
              nonce = (await pjs.rpc.system.accountNextIndex(account.address)).toNumber()
              continue
            }
            throw error
          }
        }
        done++
        if (done % 50 === 0 || done === blocks.length) {
          progress(`  stored ${done}/${blocks.length}`)
        }
      }
    })
  )

  await pjs.disconnect()
  client.destroy()
}

export interface PublishResult {
  manifestCid: string
  shardCount: number
}

/**
 * Publish sorted lines as a snapshot and return the manifest CID.
 *
 * `lines` must already be sorted by the same key `shardKeyOf` reads, or the
 * reader binary search will miss entries.
 */
export async function publishSnapshot(options: {
  version: number
  genesis: string
  bulletinRpc: string
  mnemonic: string
  lines: string[]
  shardKeyOf: (line: string) => string | null
  generatedAt?: number
  progress?: PublishProgress
}): Promise<PublishResult> {
  const { version, genesis, bulletinRpc, mnemonic, lines, shardKeyOf } = options
  const progress = options.progress ?? noop

  const { manifestCid, blocks, shardCount } = buildSnapshotBlocks({
    version,
    network: genesis,
    lines,
    shardKeyOf,
    generatedAt: options.generatedAt ?? Date.now()
  })

  progress(`blocks:    ${blocks.length} (${shardCount} shards + manifest)`)
  await storeBlocks(mnemonic, blocks, bulletinRpc, progress)

  return { manifestCid, shardCount }
}

/**
 * The pallet-revive surface a pointer write uses.
 *
 * Callers pass a `getTypedApi` result, so these names are checked against the
 * generated descriptors at the call site rather than asserted here. Getting
 * `weight_limit` wrong stops the build instead of the job.
 */
export interface RevivePointerApi {
  apis: {
    ReviveApi: {
      call: (
        origin: SS58String,
        dest: `0x${string}`,
        value: bigint,
        weightLimit: { ref_time: bigint; proof_size: bigint } | undefined,
        storageDepositLimit: bigint | undefined,
        inputData: EncodedBytes
      ) => Promise<{
        weight_required: { ref_time: bigint; proof_size: bigint }
        storage_deposit: { value: bigint }
        result: { success: true; value: { flags: unknown } } | { success: false; value: unknown }
      }>
    }
  }
  tx: {
    Revive: {
      map_account: () => {
        signAndSubmit: (signer: PolkadotSigner) => Promise<{ ok: boolean }>
      }
      call: (args: {
        dest: `0x${string}`
        value: bigint
        weight_limit: { ref_time: bigint; proof_size: bigint }
        storage_deposit_limit: bigint
        data: EncodedBytes
      }) => {
        signAndSubmit: (signer: PolkadotSigner) => Promise<{ ok: boolean }>
      }
    }
  }
}

/**
 * Record a manifest CID in the text record clients read it from.
 *
 * Must be signed by the account that owns `domain`, since the content resolver
 * rejects anyone else. Weight comes from a dry-run rather than a fixed ceiling,
 * so a runtime weight change does not silently start failing.
 *
 * Set `dryRun` to stop once the call is known to succeed. That check is the one
 * worth running before trusting a key, and it costs nothing.
 */
export async function updateSnapshotPointer(options: {
  api: RevivePointerApi
  contentResolver: `0x${string}`
  domain: string
  key: string
  cid: string
  mnemonic: string
  derivation?: string
  dryRun?: boolean
  progress?: PublishProgress
}): Promise<void> {
  const progress = options.progress ?? noop
  const { api } = options
  {
    const derive = sr25519CreateDerive(entropyToMiniSecret(mnemonicToEntropy(options.mnemonic)))
    const keypair = derive(options.derivation ?? '')
    const signer = getPolkadotSigner(keypair.publicKey, 'Sr25519', keypair.sign)
    const origin = ss58Address(keypair.publicKey)
    const dest = options.contentResolver
    const data = Binary.fromHex(encodeTextWrite(options.domain, options.key, options.cid))

    progress(`pointer:   ${options.domain} ${options.key} as ${origin.slice(0, 8)}…`)

    // Contract calls need the caller mapped to an H160. Mapping twice is an
    // error, so a failure here is expected on every run after the first. A dry
    // run skips it to keep its promise of submitting nothing, which means an
    // unmapped account reports a failed dispatch rather than an ownership answer.
    if (!options.dryRun) {
      await api.tx.Revive.map_account()
        .signAndSubmit(signer)
        .catch(() => undefined)
    }

    const dryRun = await api.apis.ReviveApi.call(
      origin,
      dest,
      0n,
      UNLIMITED_WEIGHT,
      UNLIMITED_DEPOSIT,
      data
    )
    // A rejected dispatch and a reverting contract are different failures. The
    // resolver rejecting a non-owner is the second, which surfaces as a
    // successful dispatch carrying the revert bit rather than as an error.
    if (!dryRun.result.success) {
      throw new Error(`setText dry-run failed to dispatch for ${origin}`)
    }
    if ((Number(dryRun.result.value.flags) & 1) === 1) {
      throw new Error(`setText dry-run reverted, is ${origin} the owner of ${options.domain}?`)
    }
    progress(`pointer:   dry-run passed, ${dryRun.weight_required.ref_time} ref_time`)
    if (options.dryRun) return

    const submit = () =>
      api.tx.Revive.call({
        dest,
        value: 0n,
        // Double the measured weight. The dry-run runs against the current best
        // block and the real call lands a block or two later.
        weight_limit: {
          ref_time: dryRun.weight_required.ref_time * 2n,
          proof_size: dryRun.weight_required.proof_size * 2n
        },
        storage_deposit_limit: dryRun.storage_deposit.value * 2n,
        data
      }).signAndSubmit(signer)

    // The publish that precedes this leaves a burst of our own transactions in
    // flight, so the account nonce is a moving target. Retry the same way the
    // block storage does rather than lose a snapshot that is already paid for.
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await submit()
        if (!result.ok) throw new Error('setText transaction failed in block')
        break
      } catch (error) {
        if (attempt >= POINTER_ATTEMPTS) throw error
        progress(`pointer:   attempt ${attempt} failed (${String(error)}), retrying`)
        await new Promise((resolve) => setTimeout(resolve, attempt * POINTER_RETRY_MS))
      }
    }
    progress(`pointer:   recorded ${options.cid}`)
  }
}
