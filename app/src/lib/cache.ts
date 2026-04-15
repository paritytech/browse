import { dlog } from './debug'
import { storage } from './local-storage'
import { type AppEntry } from '../state/apps/types'

const KEY_PCF = 'browse:pcf'

interface CachedData {
  apps: AppEntry[]
  timestamp: number
}

export async function getCachedPcf(): Promise<AppEntry[]> {
  const cached = await storage.readJSON<CachedData>(KEY_PCF)
  return cached?.apps ?? []
}

export async function setCachedPcf(apps: AppEntry[]): Promise<void> {
  await storage.writeJSON(KEY_PCF, { apps, timestamp: Date.now() })
  dlog(`Cache: saved ${apps.length} PCF apps`)
}
