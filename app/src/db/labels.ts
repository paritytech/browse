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

async function readAll(): Promise<LabelEntry[]> {
  return (await localStorage.readJSON<LabelEntry[]>(KEY)) ?? []
}

export async function readAllLabels(): Promise<LabelEntry[]> {
  return readAll()
}

export async function updateLabels(entries: LabelEntry[]): Promise<void> {
  if (entries.length === 0) return
  const byLabel = new Map((await readAll()).map((l) => [l.label, l]))
  for (const e of entries) byLabel.set(e.label, e)
  await localStorage.writeJSON(KEY, [...byLabel.values()])
}
