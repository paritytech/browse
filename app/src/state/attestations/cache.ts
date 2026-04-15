import { dlog } from '../../lib/debug'
import { storage } from '../../lib/local-storage'
import { type AppEntry } from '../apps/types'

const KEY_FOLLOWED = 'browse:followed'

interface CachedData {
  apps: AppEntry[]
  timestamp: number
}

export async function getCachedFollowed(): Promise<string[]> {
  const cached = await storage.readJSON<CachedData>(KEY_FOLLOWED)
  return cached?.apps?.map((a) => a.label) ?? []
}

export async function setCachedFollowed(labels: string[]): Promise<void> {
  const apps = labels.map((label) => ({ label }) as AppEntry)
  await storage.writeJSON(KEY_FOLLOWED, { apps, timestamp: Date.now() })
  dlog(`Cache: saved ${labels.length} followed labels`)
}
