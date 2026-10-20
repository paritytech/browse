import {
  KNOWN_NETWORKS,
  PASEONEXTV2_ASSETHUB_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS
} from '@parity/browse-sdk'
import type {
  DevAccount,
  DevAccountName,
  NetworkConfig
} from '@parity/truapi-host/testing/playwright'
import type { TestHostServerOptions } from '@parity/truapi-host/testing/server'
import type { Frame, Page } from '@playwright/test'

// A portal-specific default keeps the suite off 5173, where another vite dev
// server is often already running and would be silently reused.
const PORT = process.env.PORT ?? '5273'
const APP_URL = `http://localhost:${PORT}`

export { APP_URL, PORT }

const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  [PASEONEXTV2_ASSETHUB_GENESIS]: { symbol: 'PAS', decimals: 10 },
  [PREVIEWNET_ASSETHUB_GENESIS]: { symbol: 'UNIT', decimals: 12 }
}

export function activeGenesis(): keyof typeof KNOWN_NETWORKS {
  const genesis = process.env.NETWORK_GENESIS_HASH
  return genesis === PASEONEXTV2_ASSETHUB_GENESIS
    ? PASEONEXTV2_ASSETHUB_GENESIS
    : PREVIEWNET_ASSETHUB_GENESIS
}

/**
 * The Asset Hub and People chains the test host routes for the active genesis.
 *
 * The identity flow reads `Resources.UsernameOwnerOf` on People, so both are
 * registered even though the smoke tests do not hit the chain. The host reads
 * the role of each chain off the `id` suffix.
 */
function networks(): NetworkConfig[] {
  const genesis = activeGenesis()
  const net = KNOWN_NETWORKS[genesis]
  const token = TOKENS[genesis]
  const list: NetworkConfig[] = [
    {
      id: `${net.TLD}-asset-hub`,
      name: 'Asset Hub',
      genesisHash: genesis,
      rpcUrl: net.ASSETHUB_RPCS[0],
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals
    }
  ]
  if (net.PEOPLE_GENESIS && net.PEOPLE_RPCS?.[0]) {
    list.push({
      id: `${net.TLD}-people`,
      name: 'People',
      genesisHash: net.PEOPLE_GENESIS,
      rpcUrl: net.PEOPLE_RPCS[0],
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals
    })
  }
  return list
}

/**
 * Start a test host serving `chains`. The server takes no `networks`, so they
 * are expanded here into the chain proxies and runtime config they stand for.
 * Tracked in paritytech/trinity-user-agents#1388.
 */
async function startHost(chains: NetworkConfig[], options: Partial<TestHostServerOptions>) {
  const { createTestHostServer } = await import('@parity/truapi-host/testing/server')
  const { fromNetworks } = await import('@parity/truapi-host/testing/playwright')
  const { mock, runtimeConfig } =
    chains.length > 0 ? fromNetworks(chains) : { mock: undefined, runtimeConfig: {} }
  return createTestHostServer({
    productUrl: APP_URL,
    mock,
    runtimeConfig: { ...runtimeConfig, networkSuffix: KNOWN_NETWORKS[activeGenesis()].TLD },
    ...options
  })
}

/** A host with no session: the user has not signed in. */
export async function startUnsignedHost() {
  return startHost(networks(), { loginBehavior: 'manual' })
}

/**
 * A host with no networks configured and no session, so every chain read fails.
 *
 * The test host reports any genesis as supported unless told otherwise, and with
 * no chain proxy it answers a connection with silence, so the app would wait on
 * a read that never ends. Reporting chains as unsupported is what makes the read
 * fail the way it does on a host that does not serve the network. Tracked in
 * paritytech/trinity-user-agents#1388.
 */
export async function startBareHost() {
  return startHost([], { loginBehavior: 'manual', mock: { featureSupported: false } })
}

export async function startSignedHost(...accounts: (DevAccountName | DevAccount)[]) {
  return startHost(networks(), { accounts: accounts.length > 0 ? accounts : ['alice'] })
}

/**
 * Open the host page and wait for its control surface. A signed host has a
 * session from boot, so getUserId resolves. startUnsignedHost starts one
 * without a session.
 */
export async function navigateToTestHost(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl, { waitUntil: 'commit' })
  await page.waitForFunction(
    () => !!(window as unknown as { __TEST_HOST__: unknown }).__TEST_HOST__,
    { timeout: 30_000 }
  )
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
        window as unknown as { __TEST_HOST__: { seedPreimage(value: Uint8Array): Uint8Array } }
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
