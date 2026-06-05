import { localStorage } from '../lib/local-storage'

const KEY = 'browse:bookmarks'

export type Bookmarks = string[]

export async function readBookmarks(): Promise<Bookmarks> {
  return (await localStorage.readJSON<Bookmarks>(KEY)) ?? []
}

export async function createBookmark(label: string): Promise<void> {
  const labels = await readBookmarks()
  if (!labels.includes(label)) {
    labels.push(label)
    await localStorage.writeJSON(KEY, labels)
  }
}

export async function deleteBookmark(label: string): Promise<void> {
  const labels = await readBookmarks()
  await localStorage.writeJSON(
    KEY,
    labels.filter((other) => other !== label)
  )
}
