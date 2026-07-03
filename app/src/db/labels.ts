import { localStorage } from '../lib/local-storage'
import type { AppCertificate } from '../state/apps/types'

const KEY = 'browse:labels'

export interface LabelEntry {
  label: string
  name: string | null
  description: string
  iconCid: string | null
  contentHash: string | null
  attestationCount: number | null
  hasUserAttested: boolean
  certificate?: AppCertificate | null
  fetchedAt?: number
  published?: boolean
}

export async function readLabels(): Promise<LabelEntry[]> {
  return (await localStorage.readJSON<LabelEntry[]>(KEY)) ?? []
}

export async function createOrUpdateLabels(labels: LabelEntry[]): Promise<void> {
  await localStorage.writeJSON(KEY, labels)
}

/** Upsert a single label without disturbing the rest of the DB. */
export async function upsertLabel(entry: LabelEntry): Promise<void> {
  const all = await readLabels()
  const idx = all.findIndex((l) => l.label === entry.label)
  if (idx === -1) {
    all.push(entry)
  } else {
    all[idx] = { ...all[idx], ...entry }
  }
  await createOrUpdateLabels(all)
}

export async function updateAttestationCount(
  label: string,
  delta: 1 | -1,
  hasUserAttested: boolean
): Promise<void> {
  const labels = await readLabels()
  const idx = labels.findIndex((l) => l.label === label)
  if (idx === -1) return
  const current = labels[idx].attestationCount ?? 0
  labels[idx] = {
    ...labels[idx],
    attestationCount: Math.max(0, current + delta),
    hasUserAttested
  }
  await createOrUpdateLabels(labels)
}
