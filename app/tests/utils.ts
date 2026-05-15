import type { Frame, Page } from '@playwright/test'

const PORT = process.env.PORT ?? '5173'
const APP_URL = `http://localhost:${PORT}`

type Account = import('@parity/host-api-test-sdk').Account
type ChainConfig = import('@parity/host-api-test-sdk').ChainConfig

const PASEO_ASSET_HUB_NEXT_V2: ChainConfig = {
  id: 'paseo-asset-hub-next-v2',
  name: 'Paseo Asset Hub Next V2',
  genesisHash: '0x173cea9df45656cf612c8b8ece56e04e9a693c69cfaac47d3628dae735067af8',
  rpcUrl: 'wss://paseo-asset-hub-next-rpc.polkadot.io',
  tokenSymbol: 'PAS',
  tokenDecimals: 10
}

export { APP_URL, PORT }

export async function startSignedHost(...accounts: Account[]) {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  return createTestHostServer({
    productUrl: APP_URL,
    accounts: accounts.length > 0 ? accounts : ['alice'],
    chain: PASEO_ASSET_HUB_NEXT_V2
  })
}

export async function startUnsignedHost() {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  return createTestHostServer({
    productUrl: APP_URL,
    accounts: [],
    chain: PASEO_ASSET_HUB_NEXT_V2
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
