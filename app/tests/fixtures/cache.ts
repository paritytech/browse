import type { Frame } from '@playwright/test'

const CACHED_STORE_ADDRESS = '0x000000000000000000000000000000000ca6aced'

const CACHED_LABEL_ENTRIES = [
  { label: 'e2e-test-app-alpha', name: 'Alpha App', description: 'First test app', contentHash: 'ipfs://QmE2eTestAlpha', attestationCount: 0 },
  { label: 'e2e-test-app-beta', name: 'Beta App', description: 'Second test app', contentHash: 'ipfs://QmE2eTestBeta', attestationCount: 0 },
  { label: 'e2e-test-app-gamma', name: 'Gamma App', description: 'Third test app', contentHash: 'ipfs://QmE2eTestGamma', attestationCount: 0 },
]

export async function createCachedApps(frame: Frame): Promise<void> {
  await frame.evaluate(
    async ({ labels, storeAddress }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('browse-cache', 1)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(['labelToMetadata', 'storeAddressToStore'], 'readwrite')
          for (const entry of labels) tx.objectStore('labelToMetadata').put(entry)
          tx.objectStore('storeAddressToStore').put({
            storeAddress,
            ownerH160Address: null,
            ownerSS58Address: 'e2e-test-owner',
            labels: labels.map((l: { label: string }) => l.label)
          })
          tx.oncomplete = () => { db.close(); resolve() }
          tx.onerror = () => { db.close(); reject(tx.error) }
        }
        req.onerror = () => reject(req.error)
      })
    },
    { labels: CACHED_LABEL_ENTRIES, storeAddress: CACHED_STORE_ADDRESS }
  )
}
