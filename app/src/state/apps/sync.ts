/**
 * Orchestrates apps discovery, hydration, and persistence.
 *
 * Owns chunking, TTL refresh, mid-batch persistence, and progress reporting.
 * Sits between `./remote` and `./queries` (React Query).
 */

import { resolveIdentityH160 } from './identity'
import {
  HYDRATE_CHUNK_SIZE,
  hydrateLabelChunk,
  readPublishedLabelhashes,
  resolveLabels
} from './remote'
import type { AppEntry } from './types'
import { createOrUpdateLabels, type LabelEntry } from '../../db/labels'
import { hiddenLog } from '../../lib/debug'

const METADATA_TTL_MS = 60 * 1000

function labelToApp(l: LabelEntry): AppEntry {
  return {
    label: l.label,
    name: l.name,
    description: l.description,
    iconCid: l.iconCid ?? null,
    contentHash: l.contentHash,
    isLive: l.contentHash !== null,
    attestationCount: l.attestationCount,
    hasUserAttested: l.hasUserAttested,
    isCompliant: l.isCompliant ?? false
  }
}

/**
 * Collapse a label cache into the live {@link AppEntry} list for the All tab.
 */
export function materialize(labels: Map<string, LabelEntry>): AppEntry[] {
  const apps: AppEntry[] = []
  for (const metadata of labels.values()) {
    if (!metadata.contentHash) continue
    if (metadata.published === false) continue
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
  identityH160: `0x${string}` | null,
  publishedNames: ReadonlySet<string>,
  onProgress?: (apps: AppEntry[]) => void
): Promise<void> {
  for (let i = 0; i < batch.length; i += HYDRATE_CHUNK_SIZE) {
    const chunk = batch.slice(i, i + HYDRATE_CHUNK_SIZE)
    const entries = await hydrateLabelChunk(chunk, identityH160)
    // `published` is derived from the current Publisher set, not from hydration:
    // bookmarked labels are refreshed too but stay out of the All list.
    for (const entry of entries) {
      labels.set(entry.label, { ...entry, published: publishedNames.has(entry.label) })
    }
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
  onProgress?: (apps: AppEntry[]) => void,
  protectedLabels: ReadonlySet<string> = new Set()
): Promise<AppEntry[]> {
  const t0 = performance.now()
  hiddenLog(`Starting synchronization - cache holds ${cachedLabels.length} labels`)
  const labels = new Map(cachedLabels.map((entry) => [entry.label, entry]))

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

  // Drop cached labels no longer in the published set, except bookmarked/followed
  // ones.
  for (const name of [...labels.keys()]) {
    if (!publishedNames.has(name) && !protectedLabels.has(name)) labels.delete(name)
  }

  // `published` is recomputed every sync from the current Publisher set. A kept
  // bookmark that isn't published is marked false, so it shows in Bookmarks but
  // never in the All list.
  for (const [name, entry] of labels) {
    entry.published = publishedNames.has(name)
  }

  // New labels we need metadata for.
  const newLabels: string[] = []
  for (const name of publishedNames) {
    if (!labels.has(name)) newLabels.push(name)
  }

  // Stale (TTL-expired) cached labels need a metadata refresh. The hydrate path re-checks contenthash to detect content that
  // went away.
  const nowMs = Date.now()
  const staleLabels: string[] = []
  for (const entry of labels.values()) {
    if (!entry.fetchedAt || nowMs - entry.fetchedAt > METADATA_TTL_MS) staleLabels.push(entry.label)
  }

  const toRefresh = [...staleLabels, ...newLabels]
  if (toRefresh.length > 0) {
    const identityH160 = await resolveIdentityH160()
    if (staleLabels.length > 0) {
      hiddenLog(`Refreshing ${staleLabels.length} stale label(s) (TTL ${METADATA_TTL_MS / 1000}s)`)
    }
    if (newLabels.length > 0) {
      hiddenLog(
        `Hydrating ${newLabels.length} new label(s)${identityH160 ? ' (including your attestations)' : ''}`
      )
    }
    await flushLabelBatch(labels, toRefresh, identityH160, publishedNames, onProgress)
  }

  const apps = materialize(labels)
  hiddenLog(
    `Synchronization complete: ${apps.length} apps in ${((performance.now() - t0) / 1000).toFixed(1)}s`
  )
  return apps
}
