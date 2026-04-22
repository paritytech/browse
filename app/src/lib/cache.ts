import { hiddenLog } from './debug'
import { localStorage } from './local-storage'
import { type AppEntry } from '../state/apps/types'

const KEY_PCF = 'browse:pcf'

interface CachedData {
  apps: AppEntry[]
  timestamp: number
}

export async function getCachedPcf(): Promise<AppEntry[]> {
  const cached = await localStorage.readJSON<CachedData>(KEY_PCF)
  const apps = cached?.apps ?? []
  if (apps.length > 0) {
    hiddenLog(`Loaded ${apps.length} curated apps from cache`)
  }
  return apps
}

export async function setCachedPcf(apps: AppEntry[]): Promise<void> {
  await localStorage.writeJSON(KEY_PCF, { apps, timestamp: Date.now() })
  hiddenLog(`Saved ${apps.length} curated apps to cache`)
}
