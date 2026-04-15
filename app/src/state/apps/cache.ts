import { type AppEntry } from './types'
import { dlog } from '../../lib/debug'
import { storage } from '../../lib/local-storage'

const KEY_ALL = 'browse:all'

interface CachedData {
  apps: AppEntry[]
  timestamp: number
}

export async function getCachedAll(): Promise<AppEntry[]> {
  const cached = await storage.readJSON<CachedData>(KEY_ALL)
  return cached?.apps ?? []
}

export async function setCachedAll(apps: AppEntry[]): Promise<void> {
  await storage.writeJSON(KEY_ALL, { apps, timestamp: Date.now() })
  dlog(`Cache: saved ${apps.length} All apps`)
}
