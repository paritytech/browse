import type { Frame, Page } from '@playwright/test'

const PORT = process.env.PORT ?? '5173'
const APP_URL = `http://localhost:${PORT}`

type Account = import('@parity/host-api-test-sdk').Account
type ChainConfig = import('@parity/host-api-test-sdk').ChainConfig

const PASEO_ASSET_HUB_NEXT_V2: ChainConfig = {
  id: 'paseo-asset-hub-next-v2',
  name: 'Paseo Asset Hub Next V2',
  genesisHash: '0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f',
  rpcUrl: 'wss://paseo-asset-hub-next-rpc.polkadot.io',
  tokenSymbol: 'PAS',
  tokenDecimals: 10
}

// Previewnet gets reset periodically so the test-sdk's hardcoded genesis
// drifts. Keep the canonical value in lock-step with the browse-sdk config.
const PREVIEWNET_ASSET_HUB: ChainConfig = {
  id: 'previewnet-asset-hub',
  name: 'Previewnet Asset Hub',
  genesisHash: '0x29f7b15e6227f86b90bf5199b5c872c28649a30e5f15fae6dd8fa9d5d48d6fbb',
  rpcUrl: 'wss://previewnet.substrate.dev/asset-hub',
  tokenSymbol: 'UNIT',
  tokenDecimals: 12
}

function activeNetwork(): ChainConfig {
  const genesis = process.env.VITE_ACTIVE_GENESIS
  if (genesis === PASEO_ASSET_HUB_NEXT_V2.genesisHash) return PASEO_ASSET_HUB_NEXT_V2
  return PREVIEWNET_ASSET_HUB
}

export { APP_URL, PORT }

function productAccountMap(accounts: Account[]): Record<string, Account> | undefined {
  const primary = accounts[0]
  if (!primary) return undefined
  return { [`localhost:${PORT}/0`]: primary }
}

export async function startSignedHost(...accounts: Account[]) {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  const resolved = accounts.length > 0 ? accounts : (['alice'] as Account[])
  return createTestHostServer({
    productUrl: APP_URL,
    accounts: resolved,
    chain: activeNetwork(),
    productAccounts: productAccountMap(resolved)
  })
}

export async function startUnsignedHost() {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  return createTestHostServer({
    productUrl: APP_URL,
    accounts: [],
    chain: activeNetwork()
  })
}

export async function navigateToTestHost(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl, { waitUntil: 'commit' })
  await page.waitForFunction(
    () => !!(window as unknown as { __TEST_HOST__: unknown }).__TEST_HOST__,
    { timeout: 30_000 }
  )
}

export async function getProductFrame(page: Page, readySelector = '.product-card'): Promise<Frame> {
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
