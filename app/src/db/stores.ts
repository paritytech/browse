import { localStorage } from '../lib/local-storage'

export interface StoreEntry {
  storeAddress: string
  ownerH160Address: string | null
  ownerSS58Address: string | null
  labels: string[] // normalized (no .dot suffix)
}

const KEY = 'browse:stores'

export async function readAllStores(): Promise<StoreEntry[]> {
  return (await localStorage.readJSON<StoreEntry[]>(KEY)) ?? []
}

export async function writeAllStores(stores: StoreEntry[]): Promise<void> {
  await localStorage.writeJSON(KEY, stores)
}
