import { localStorage } from '../lib/local-storage'
import { DEFAULT_SORT_MODE, isSortMode, type SortMode } from '../state/apps/types'

const KEY = 'browse:sort-mode'

export async function readSortMode(): Promise<SortMode> {
  const stored = await localStorage.readJSON<string>(KEY)
  return stored && isSortMode(stored) ? stored : DEFAULT_SORT_MODE
}

export async function writeSortMode(sort: SortMode): Promise<void> {
  await localStorage.writeJSON(KEY, sort)
}
