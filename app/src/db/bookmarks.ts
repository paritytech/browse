import { localStorage } from '../lib/local-storage'

const KEY = 'browse:bookmarks'

export type Bookmarks = string[]

export async function readBookmarks(): Promise<Bookmarks> {
  return (await localStorage.readJSON<Bookmarks>(KEY)) ?? []
}

/** The bookmarks, raising when the store cannot be read at all. */
export async function readBookmarksOrThrow(): Promise<Bookmarks> {
  return (await localStorage.readJSONOrThrow<Bookmarks>(KEY)) ?? []
}

/**
 * The bookmarks, retrying a store that will not answer. An empty list is what
 * the tab renders, so a read that failed would look like a user with none.
 */
export async function readBookmarksWithRetry(attempts = 5): Promise<Bookmarks> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await readBookmarksOrThrow()
    } catch (err) {
      if (attempt === attempts) throw err
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
    }
  }
  return []
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
