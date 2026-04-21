import type { Frame, Page } from '@playwright/test'

const PORT = process.env.PORT ?? '5173'
const APP_URL = `http://localhost:${PORT}`

type Account = import('@parity/host-api-test-sdk').Account

export { APP_URL, PORT }

export async function startSignedHost(...accounts: Account[]) {
  const { createTestHostServer, PASEO_ASSET_HUB } = await import('@parity/host-api-test-sdk')
  return createTestHostServer({
    productUrl: APP_URL,
    accounts: accounts.length > 0 ? accounts : ['alice'],
    chain: PASEO_ASSET_HUB
  })
}

export async function startUnsignedHost() {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  return createTestHostServer({ productUrl: APP_URL, accounts: [] })
}

export async function navigateToTestHost(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl, { waitUntil: 'commit' })
  await page.waitForFunction(
    () => !!(window as unknown as { __TEST_HOST__: unknown }).__TEST_HOST__,
    { timeout: 30_000 }
  )
}

// Fake store address for test-seeded apps — not a real on-chain store.
const SEED_STORE_ADDRESS = '0x000000000000000000000000000000000e2e7e57'

const SEED_LABEL_ENTRIES = [
  { label: 'e2e-test-app-alpha', name: 'Alpha App', description: 'First test app', contentHash: 'ipfs://QmE2eTestAlpha', attestationCount: 0 },
  { label: 'e2e-test-app-beta', name: 'Beta App', description: 'Second test app', contentHash: 'ipfs://QmE2eTestBeta', attestationCount: 0 },
  { label: 'e2e-test-app-gamma', name: 'Gamma App', description: 'Third test app', contentHash: 'ipfs://QmE2eTestGamma', attestationCount: 0 },
]

/**
 * Seed the All apps cache into IndexedDB at the app origin so cards render
 * immediately without waiting for the on-chain scan.
 * Opens a temporary page at APP_URL to write to the correct IDB origin.
 * Must be called before navigateToTestHost.
 */
export async function seedAppsInAllTab(page: Page): Promise<void> {
  const seedPage = await page.context().newPage()
  await seedPage.goto(APP_URL, { waitUntil: 'load' })
  await seedPage.evaluate(
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
            labels: labels.map((l: { label: string }) => l.label),
          })
          tx.oncomplete = () => { db.close(); resolve() }
          tx.onerror = () => { db.close(); reject(tx.error) }
        }
        req.onerror = () => reject(req.error)
      })
    },
    { labels: SEED_LABEL_ENTRIES, storeAddress: SEED_STORE_ADDRESS }
  )
  await seedPage.close()
}

export async function getProductFrame(
  page: Page,
  readySelector = '.product-card'
): Promise<Frame> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const frames = page.frames()
    const productFrame = frames.find((f) => f !== page.mainFrame() && f.url().includes('localhost'))
    if (!productFrame) {
      await page.waitForTimeout(500)
      continue
    }
    try {
      await productFrame.waitForSelector(readySelector, {
        timeout: Math.min(30_000, deadline - Date.now())
      })
      return productFrame
    } catch {
      await page.waitForTimeout(500)
    }
  }
  throw new Error(`Could not find product frame with "${readySelector}" ready`)
}
