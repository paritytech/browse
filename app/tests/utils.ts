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

const SEED_ALL_APPS = [
  { label: 'e2e-test-app-alpha', name: 'Alpha App', description: 'First test app', contentHash: null, isLive: true, vouchCount: 5, source: 'all' },
  { label: 'e2e-test-app-beta', name: 'Beta App', description: 'Second test app', contentHash: null, isLive: true, vouchCount: 3, source: 'all' },
  { label: 'e2e-test-app-gamma', name: 'Gamma App', description: 'Third test app', contentHash: null, isLive: true, vouchCount: 1, source: 'all' }
]

/**
 * Seed the All apps cache into the host page's localStorage so cards
 * render immediately without waiting for the on-chain scan.
 * Must be called before navigateToTestHost.
 */
export async function seedAllApps(page: Page): Promise<void> {
  await page.addInitScript((apps: typeof SEED_ALL_APPS) => {
    const data = { apps, timestamp: Date.now() }
    localStorage.setItem('test-host:browse:all', JSON.stringify(data))
  }, SEED_ALL_APPS)
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
