import { localStorage } from '../lib/local-storage'
import type { LabelEntry } from '../state/apps/types'

const KEY = 'browse:labels'

export async function readAllLabels(): Promise<LabelEntry[]> {
  return (await localStorage.readJSON<LabelEntry[]>(KEY)) ?? []
}

export async function createOrUpdateLabels(labels: LabelEntry[]): Promise<void> {
  await localStorage.writeJSON(KEY, labels)
}

export async function updateAttestationCount(
  label: string,
  delta: 1 | -1,
  hasUserAttested: boolean
): Promise<void> {
  const labels = await readAllLabels()
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
