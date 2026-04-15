import { storage } from '../../lib/local-storage'

const KEY = 'browse:bookmarks'

export async function getBookmarks(): Promise<Set<string>> {
  const labels = (await storage.readJSON<string[]>(KEY)) ?? []
  return new Set(labels)
}

export async function addBookmark(label: string): Promise<void> {
  const labels = (await storage.readJSON<string[]>(KEY)) ?? []
  if (!labels.includes(label)) {
    labels.push(label)
    await storage.writeJSON(KEY, labels)
  }
}

export async function removeBookmark(label: string): Promise<void> {
  const labels = (await storage.readJSON<string[]>(KEY)) ?? []
  await storage.writeJSON(
    KEY,
    labels.filter((l) => l !== label)
  )
}
