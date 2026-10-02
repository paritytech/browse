/**
 * The domains a developer tracks in this portal.
 *
 * Adding a domain is a local bookmark, never a chain write: a developer collects
 * the names they work on before any of them is published, and publishing is the
 * separate explicit step on the detail page. The list therefore lives in host
 * local storage and needs no host identity to read or change.
 */

import { ensureStore } from './store'

const KEY = 'tracked'

/** The tracked labels, in the order they were added. Empty when none. */
export async function readTracked(): Promise<string[]> {
  try {
    const store = await ensureStore()
    return (await store.getJSON<string[]>(KEY)) ?? []
  } catch {
    return []
  }
}

async function write(labels: string[]): Promise<string[]> {
  try {
    const store = await ensureStore()
    await store.setJSON(KEY, labels)
  } catch {
    return readTracked()
  }
  return labels
}

/** Track a label. Already-tracked labels are left in place. Returns the new list. */
export async function trackDomain(label: string): Promise<string[]> {
  const tracked = await readTracked()
  if (tracked.includes(label)) return tracked
  return write([...tracked, label])
}

/** Stop tracking a label. Leaves any network publication untouched. */
export async function untrackDomain(label: string): Promise<string[]> {
  const tracked = await readTracked()
  if (!tracked.includes(label)) return tracked
  return write(tracked.filter((entry) => entry !== label))
}
