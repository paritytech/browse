import { hiddenLog } from '../../lib/debug'
import { localStorage } from '../../lib/local-storage'
import { type AppEntry } from '../apps/types'

const KEY_FOLLOWED = 'browse:followed'

interface CachedData {
  apps: AppEntry[]
  timestamp: number
}

export async function getCachedFollowed(): Promise<string[]> {
  const cached = await localStorage.readJSON<CachedData>(KEY_FOLLOWED)
  return cached?.apps?.map((app) => app.label) ?? []
}

export async function setCachedFollowed(labels: string[]): Promise<void> {
  const apps = labels.map((label) => ({ label }) as AppEntry)
  await localStorage.writeJSON(KEY_FOLLOWED, { apps, timestamp: Date.now() })
  hiddenLog(`Saved ${labels.length} followed labels to cache`)
}
