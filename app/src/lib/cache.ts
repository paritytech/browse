import { hostLocalStorage } from '@novasamatech/product-sdk'

import { type AppEntry, isHosted } from '../data'
import { dlog } from './debug'

const KEY_PCF = 'browse:pcf'
const KEY_ALL = 'browse:all'

interface CachedData {
  apps: AppEntry[]
  timestamp: number
}

async function read(key: string): Promise<CachedData | null> {
  try {
    if (isHosted()) {
      return (await hostLocalStorage.readJSON(key)) as CachedData
    }
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as CachedData
  } catch {
    return null
  }
}

async function write(key: string, apps: AppEntry[]): Promise<void> {
  const data: CachedData = { apps, timestamp: Date.now() }
  try {
    if (isHosted()) {
      await hostLocalStorage.writeJSON(key, data)
    } else {
      localStorage.setItem(key, JSON.stringify(data))
    }
  } catch {
    dlog('Cache write failed', 'warn')
  }
}

export async function getCachedPcf(): Promise<AppEntry[]> {
  const cached = await read(KEY_PCF)
  return cached?.apps ?? []
}

export async function getCachedAll(): Promise<AppEntry[]> {
  const cached = await read(KEY_ALL)
  return cached?.apps ?? []
}

export async function setCachedPcf(apps: AppEntry[]): Promise<void> {
  await write(KEY_PCF, apps)
  dlog(`Cache: saved ${apps.length} PCF apps`)
}

export async function setCachedAll(apps: AppEntry[]): Promise<void> {
  await write(KEY_ALL, apps)
  dlog(`Cache: saved ${apps.length} All apps`)
}
