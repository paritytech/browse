import { localStorage } from '../lib/local-storage'
import { isSortMode, type SortMode } from '../state/apps/types'

const KEY = 'browse:sort-mode'

export async function readSortMode(): Promise<SortMode> {
  const stored = await localStorage.readJSON<string>(KEY)
  return stored && isSortMode(stored) ? stored : 'new'
}

export async function writeSortMode(sort: SortMode): Promise<void> {
  await localStorage.writeJSON(KEY, sort)
}
