import { localStorage } from '../lib/local-storage'

export interface LabelEntry {
  label: string
  name: string | null
  description: string
  contentHash: string | null
  attestationCount: number | null
  hasUserAttested: boolean
  fetchedAt?: number
}

const KEY = 'browse:labels'

export async function readAllLabels(): Promise<LabelEntry[]> {
  return (await localStorage.readJSON<LabelEntry[]>(KEY)) ?? []
}

export async function writeAllLabels(labels: LabelEntry[]): Promise<void> {
  await localStorage.writeJSON(KEY, labels)
}
