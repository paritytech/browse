import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

export interface StoreCacheEntry {
  storeAddress: string
  ownerH160Address: string | null
  ownerSS58Address: string | null
  labels: string[] // normalized (no .dot suffix)
}

export interface LabelCacheEntry {
  label: string
  name: string | null
  description: string
  contentHash: string | null
  attestationCount: number | null
}

export interface CacheMeta {
  knownStoreAddresses: string[]
}

interface BrowseDB extends DBSchema {
  storeAddressToStore: { key: string; value: StoreCacheEntry }
  labelToMetadata: { key: string; value: LabelCacheEntry }
  h160AddressToSS58Address: { key: string; value: string }
  meta: { key: 'singleton'; value: CacheMeta }
}

const DB_NAME = 'browse-cache'
const DB_VERSION = 1

let dbp: Promise<IDBPDatabase<BrowseDB>> | null = null

function getDb(): Promise<IDBPDatabase<BrowseDB>> {
  return (dbp ??= openDB<BrowseDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('storeAddressToStore'))
        db.createObjectStore('storeAddressToStore', { keyPath: 'storeAddress' })
      if (!db.objectStoreNames.contains('labelToMetadata'))
        db.createObjectStore('labelToMetadata', { keyPath: 'label' })
      if (!db.objectStoreNames.contains('h160AddressToSS58Address'))
        db.createObjectStore('h160AddressToSS58Address')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
  }))
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    dbp?.then((d) => d.close()).catch(() => {})
    dbp = null
  })
}

export async function readAllStores(): Promise<StoreCacheEntry[]> {
  return (await getDb()).getAll('storeAddressToStore')
}

export async function readAllLabels(): Promise<LabelCacheEntry[]> {
  return (await getDb()).getAll('labelToMetadata')
}

export async function updateStoresInBulk(entries: StoreCacheEntry[]): Promise<void> {
  if (entries.length === 0) return
  const db = await getDb()
  const tx = db.transaction('storeAddressToStore', 'readwrite')
  await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done])
}

export async function updateLabelsInBulk(entries: LabelCacheEntry[]): Promise<void> {
  if (entries.length === 0) return
  const db = await getDb()
  const tx = db.transaction('labelToMetadata', 'readwrite')
  await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done])
}

export async function removeStore(storeAddress: string): Promise<void> {
  await (await getDb()).delete('storeAddressToStore', storeAddress)
}

export async function readMeta(): Promise<CacheMeta> {
  const meta = await (await getDb()).get('meta', 'singleton')
  return meta ?? { knownStoreAddresses: [] }
}

export async function updateMeta(meta: CacheMeta): Promise<void> {
  await (await getDb()).put('meta', meta, 'singleton')
}

export async function readSS58Address(h160Address: string): Promise<string | null> {
  return (await (await getDb()).get('h160AddressToSS58Address', h160Address.toLowerCase())) ?? null
}

export async function updateSS58Address(h160Address: string, ss58: string): Promise<void> {
  await (await getDb()).put('h160AddressToSS58Address', ss58, h160Address.toLowerCase())
}

export async function clearCache(): Promise<void> {
  const db = await getDb()
  await Promise.all([
    db.clear('storeAddressToStore'),
    db.clear('labelToMetadata'),
    db.clear('h160AddressToSS58Address'),
    db.clear('meta')
  ])
}
