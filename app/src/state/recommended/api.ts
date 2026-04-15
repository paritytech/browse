import { storage } from '../../lib/local-storage'

const KEY = 'browse:recommended'

export async function getRecommended(): Promise<Set<string>> {
  const labels = (await storage.readJSON<string[]>(KEY)) ?? []
  return new Set(labels)
}

export async function addRecommended(label: string): Promise<void> {
  const labels = (await storage.readJSON<string[]>(KEY)) ?? []
  if (!labels.includes(label)) {
    labels.push(label)
    await storage.writeJSON(KEY, labels)
  }
}

export async function removeRecommended(label: string): Promise<void> {
  const labels = (await storage.readJSON<string[]>(KEY)) ?? []
  await storage.writeJSON(
    KEY,
    labels.filter((l) => l !== label)
  )
}
