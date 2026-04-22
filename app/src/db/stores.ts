import { localStorage } from '../lib/local-storage'

export interface StoreEntry {
  storeAddress: string
  ownerH160Address: string | null
  ownerSS58Address: string | null
  labels: string[] // normalized (no .dot suffix)
}

const KEY = 'browse:stores'

async function readAll(): Promise<StoreEntry[]> {
  return (await localStorage.readJSON<StoreEntry[]>(KEY)) ?? []
}

export async function readAllStores(): Promise<StoreEntry[]> {
  return readAll()
}

export async function updateStores(entries: StoreEntry[]): Promise<void> {
  if (entries.length === 0) return
  const byAddress = new Map((await readAll()).map((s) => [s.storeAddress, s]))
  for (const e of entries) byAddress.set(e.storeAddress, e)
  await localStorage.writeJSON(KEY, [...byAddress.values()])
}

export async function removeStore(storeAddress: string): Promise<void> {
  const all = await readAll()
  const next = all.filter((s) => s.storeAddress !== storeAddress)
  if (next.length === all.length) return
  await localStorage.writeJSON(KEY, next)
}

export async function removeStores(storeAddresses: string[]): Promise<void> {
  if (storeAddresses.length === 0) return
  const toRemove = new Set(storeAddresses)
  const all = await readAll()
  const next = all.filter((s) => !toRemove.has(s.storeAddress))
  if (next.length === all.length) return
  await localStorage.writeJSON(KEY, next)
}
