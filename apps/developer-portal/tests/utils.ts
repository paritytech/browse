import {
  KNOWN_NETWORKS,
  PASEO_ASSETHUB_NEXT_V2_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS
} from '@parity/browse-sdk'
import type { Frame, Page } from '@playwright/test'

// A portal-specific default keeps the suite off 5173, where another vite dev
// server is often already running and would be silently reused.
const PORT = process.env.PORT ?? '5273'
const APP_URL = `http://localhost:${PORT}`

export { APP_URL, PORT }

type Account = import('@parity/host-api-test-sdk').Account
type NetworkConfig = import('@parity/host-api-test-sdk').NetworkConfig

const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  [PASEO_ASSETHUB_NEXT_V2_GENESIS]: { symbol: 'PAS', decimals: 10 },
  [PREVIEWNET_ASSETHUB_GENESIS]: { symbol: 'UNIT', decimals: 12 }
}

export function activeGenesis(): keyof typeof KNOWN_NETWORKS {
  const genesis = process.env.NETWORK_GENESIS_HASH
  return genesis === PASEO_ASSETHUB_NEXT_V2_GENESIS
    ? PASEO_ASSETHUB_NEXT_V2_GENESIS
    : PREVIEWNET_ASSETHUB_GENESIS
}

/**
 * The Asset Hub and People chains the test host routes for the active genesis.
 *
 * The identity flow reads `Resources.UsernameOwnerOf` on People, so both are
 * registered even though the smoke tests do not hit the chain.
 */
function networks(): NetworkConfig[] {
  const genesis = activeGenesis()
  const net = KNOWN_NETWORKS[genesis]
  const token = TOKENS[genesis]
  const list: NetworkConfig[] = [
    {
      id: `ah-${genesis.slice(2, 10)}`,
      name: 'Asset Hub',
      genesisHash: genesis,
      rpcUrl: net.ASSETHUB_RPCS[0],
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals
    }
  ]
  if (net.PEOPLE_GENESIS && net.PEOPLE_RPCS?.[0]) {
    list.push({
      id: `people-${genesis.slice(2, 10)}`,
      name: 'People',
      genesisHash: net.PEOPLE_GENESIS,
      rpcUrl: net.PEOPLE_RPCS[0],
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals
    })
  }
  return list
}

export async function startUnsignedHost() {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  return createTestHostServer({ productUrl: APP_URL, accounts: [], networks: networks() })
}

/** A host with no networks configured, so every chain read fails. */
export async function startBareHost() {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  return createTestHostServer({ productUrl: APP_URL, accounts: [], networks: [] })
}

export async function startSignedHost(...accounts: Account[]) {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  const resolved = accounts.length > 0 ? accounts : (['alice'] as Account[])
  return createTestHostServer({ productUrl: APP_URL, accounts: resolved, networks: networks() })
}

export async function navigateToTestHost(
  page: Page,
  hostUrl: string,
  { authenticate = false }: { authenticate?: boolean } = {}
): Promise<void> {
  await page.goto(hostUrl, { waitUntil: 'commit' })
  await page.waitForFunction(
    () => !!(window as unknown as { __TEST_HOST__: unknown }).__TEST_HOST__,
    { timeout: 30_000 }
  )
  // A signed host models a logged-in user. Authenticate so getUserId resolves.
  if (authenticate) {
    await page.evaluate(() =>
      (
        window as unknown as { __TEST_HOST__: { simulateReconnect(): void } }
      ).__TEST_HOST__.simulateReconnect()
    )
  }
}

/** Navigate the product frame to the detail route for a label. */
export async function gotoDetail(frame: Frame, label: string): Promise<void> {
  await frame.evaluate((target) => {
    window.history.pushState({}, '', `/d/${target}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, label)
}

/**
 * Seed the domains snapshot fixture into the host preimage store.
 *
 * Seeds the exact bytes `buildSnapshotFixture` produced for the active
 * genesis, so lookups through `APP_DOMAINS_SNAPSHOT_CID` resolve. The config
 * sets that env from the same fixture, keeping both sides in lockstep.
 */
export async function seedSnapshotPreimage(page: Page): Promise<string> {
  const { buildSnapshotFixture } = await import('./snapshot-fixture')
  const fixture = buildSnapshotFixture(activeGenesis())
  const blocks = [...Object.values(fixture.shardBytes), fixture.manifestBytes]
  for (const bytes of blocks) {
    await page.evaluate((data) => {
      const host = (
        window as unknown as { __TEST_HOST__: { seedPreimage(value: Uint8Array): string } }
      ).__TEST_HOST__
      host.seedPreimage(new Uint8Array(data))
    }, Array.from(bytes))
  }
  return fixture.manifestCid
}

export async function getProductFrame(page: Page, readySelector = '.toolbar'): Promise<Frame> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const productFrame = page
      .frames()
      .find((f) => f !== page.mainFrame() && f.url().includes('localhost'))
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
