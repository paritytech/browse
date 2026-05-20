/**
 * Orchestrates apps discovery, hydration, and persistence.
 *
 * Owns chunking, TTL refresh, mid-batch persistence, and progress reporting.
 * Sits between `./remote` (pure on-chain reads) and `./queries` (React Query).
 */

import { resolveUserH160 } from './identity'
import {
  HYDRATE_CHUNK_SIZE,
  hydrateLabelChunk,
  readPublishedLabelhashes,
  resolveLabels
} from './remote'
import type { AppEntry, LabelEntry } from './types'
import { createOrUpdateLabels } from '../../db/labels'
import { hiddenLog } from '../../lib/debug'

const METADATA_TTL_MS = 24 * 60 * 60 * 1000

/** Shape a {@link LabelEntry} as an `'all'`-source {@link AppEntry}. */
function labelToApp(l: LabelEntry): AppEntry {
  return {
    label: l.label,
    name: l.name,
    description: l.description,
    contentHash: l.contentHash,
    isLive: l.contentHash !== null,
    attestationCount: l.attestationCount,
    hasUserAttested: l.hasUserAttested,
    source: 'all' as const
  }
}

/** Collapse a label cache into the live {@link AppEntry} list (drops non-live). */
export function materialize(labels: Map<string, LabelEntry>): AppEntry[] {
  const apps: AppEntry[] = []
  for (const metadata of labels.values()) {
    if (!metadata.contentHash) continue
    apps.push(labelToApp(metadata))
  }
  return apps
}

/**
 * Hydrate `batch` labels in chunks of {@link HYDRATE_CHUNK_SIZE}, fanning out
 * progress and persistence per chunk.
 *
 * The first-chunk persist exists so cards-on-screen are durably backed within
 * seconds rather than at the end of a long batch.
 */
async function flushLabelBatch(
  labels: Map<string, LabelEntry>,
  batch: string[],
  userH160: `0x${string}` | null,
  onProgress?: (apps: AppEntry[]) => void
): Promise<void> {
  for (let i = 0; i < batch.length; i += HYDRATE_CHUNK_SIZE) {
    const chunk = batch.slice(i, i + HYDRATE_CHUNK_SIZE)
    const entries = await hydrateLabelChunk(chunk, userH160)
    for (const entry of entries) labels.set(entry.label, entry)
    onProgress?.(materialize(labels))

    // Persist after the first chunk so cards-on-screen are durably backed
    // within seconds, not at the end of a long batch.
    if (i === 0) await createOrUpdateLabels([...labels.values()])
  }
  // Final persist captures all labels resolved across remaining chunks.
  await createOrUpdateLabels([...labels.values()])
}

/**
 * Run one full sync against the Publisher.
 *
 * Reads the published set, resolves labelhashes to strings, evicts cached
 * labels no longer present, hydrates the new + TTL-stale labels, and
 * materialises the result. Progress callbacks fire after every chunk.
 */
export async function syncAllApps(
  cachedLabels: LabelEntry[],
  onProgress?: (apps: AppEntry[]) => void
): Promise<AppEntry[]> {
  const t0 = performance.now()
  hiddenLog(`Starting synchronization - cache holds ${cachedLabels.length} labels`)
  const labels = new Map(cachedLabels.map((l) => [l.label, l]))

  let published: `0x${string}`[]
  try {
    published = await readPublishedLabelhashes()
  } catch (err) {
    hiddenLog(`Failed to fetch published set: ${err}`, 'error')
    return materialize(labels)
  }

  // Resolve labelhashes to label strings (cache hit avoids the labelOf call).
  const labelByHash = await resolveLabels(published, labels)
  const publishedNames = new Set<string>(labelByHash.values())

  // Drop cached labels no longer in the published set.
  for (const name of [...labels.keys()]) {
    if (!publishedNames.has(name)) labels.delete(name)
  }

  // New labels we need metadata for.
  const newLabels: string[] = []
  for (const name of publishedNames) {
    if (!labels.has(name)) newLabels.push(name)
  }

  // Stale (TTL-expired) cached labels need a metadata refresh too. The
  // hydrate path re-checks contenthash, so a label whose content went away
  // gets detected here.
  const nowMs = Date.now()
  const staleLabels: string[] = []
  for (const l of labels.values()) {
    if (!l.fetchedAt || nowMs - l.fetchedAt > METADATA_TTL_MS) staleLabels.push(l.label)
  }

  const toRefresh = [...staleLabels, ...newLabels]
  if (toRefresh.length > 0) {
    const userH160 = await resolveUserH160()
    if (staleLabels.length > 0) {
      hiddenLog(
        `Refreshing ${staleLabels.length} stale label(s) (TTL ${METADATA_TTL_MS / 3_600_000}h)`
      )
    }
    if (newLabels.length > 0) {
      hiddenLog(
        `Hydrating ${newLabels.length} new label(s)${userH160 ? ' (including your attestations)' : ''}`
      )
    }
    await flushLabelBatch(labels, toRefresh, userH160, onProgress)
  }

  const apps = materialize(labels)
  hiddenLog(
    `Synchronization complete: ${apps.length} apps in ${((performance.now() - t0) / 1000).toFixed(1)}s`
  )
  return apps
}
