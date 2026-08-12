import {
  KNOWN_NETWORKS,
  PASEONEXTV2_ASSETHUB_GENESIS,
  PREVIEWNET_ASSETHUB_GENESIS
} from '@parity/browse-sdk'
import type { Frame, Page } from '@playwright/test'

import { LOCALHOST_SELF_DOTNS } from '../src/lib/config'

const PORT = process.env.PORT ?? '5173'
const APP_URL = `http://localhost:${PORT}`

// smalltava.08
export const DEV_PHRASE =
  'give social ivory used surprise dignity mother boss sword lunar giggle icon'

/** Returns the run-unique id shared by the wallet path and username, or undefined locally. */
function runId(): string | undefined {
  return process.env.GITHUB_RUN_ID ?? process.env.E2E_RUN_ID
}

/**
 * Derives the wallet path for the per-run identity, off `smalltava.08`. Each CI
 * run gets a unique identity so a dead account leaving a stuck one-per-identity
 * lock on one run never blocks another, and concurrent runs never contend on the
 * same identity. Locally it falls back to the bare wallet, where a single actor
 * needs no isolation.
 */
export function identityPath(): string {
  const id = runId()
  return id ? `//wallet//run${id}` : '//wallet'
}

/** Builds the host uri for the per-run identity, matching {@link identityPath}. */
export function identityUri(): string {
  return `${DEV_PHRASE}${identityPath()}`
}

/**
 * Returns the DotNS username the per-run identity reveals on a first
 * recommendation. Locally it falls back to the real `smalltava.08`, which the
 * master identity already owns.
 */
export function identityUsername(): string {
  const id = runId()
  return id ? `smalltava.08.run${id}` : 'smalltava.08'
}

type Account = import('@parity/host-api-test-sdk').Account
type NetworkConfig = import('@parity/host-api-test-sdk').NetworkConfig

const PASEONEXTV2_ASSETHUB: NetworkConfig = {
  id: 'paseo-asset-hub-next-v2',
  name: 'PaseoNextV2 AssetHub',
  genesisHash: PASEONEXTV2_ASSETHUB_GENESIS,
  rpcUrl: KNOWN_NETWORKS[PASEONEXTV2_ASSETHUB_GENESIS].ASSETHUB_RPCS[0],
  tokenSymbol: 'PAS',
  tokenDecimals: 10
}

const PREVIEWNET_ASSETHUB: NetworkConfig = {
  id: 'previewnet-asset-hub',
  name: 'Previewnet AssetHub',
  genesisHash: PREVIEWNET_ASSETHUB_GENESIS,
  rpcUrl: KNOWN_NETWORKS[PREVIEWNET_ASSETHUB_GENESIS].ASSETHUB_RPCS[0],
  tokenSymbol: 'UNIT',
  tokenDecimals: 12
}

// People networks. The app identity-binding flow reads
// Resources.UsernameOwnerOf on the People chain via the host-routed provider, so
// the test host must route this genesis in addition to the Asset Hub.
const PASEO_PEOPLE: NetworkConfig = {
  id: 'paseo-people',
  name: 'Paseo People',
  genesisHash: KNOWN_NETWORKS[PASEONEXTV2_ASSETHUB_GENESIS].PEOPLE_GENESIS!,
  rpcUrl: KNOWN_NETWORKS[PASEONEXTV2_ASSETHUB_GENESIS].PEOPLE_RPCS![0],
  tokenSymbol: 'PAS',
  tokenDecimals: 10
}

const PREVIEWNET_PEOPLE: NetworkConfig = {
  id: 'previewnet-people',
  name: 'Previewnet People',
  genesisHash: KNOWN_NETWORKS[PREVIEWNET_ASSETHUB_GENESIS].PEOPLE_GENESIS!,
  rpcUrl: KNOWN_NETWORKS[PREVIEWNET_ASSETHUB_GENESIS].PEOPLE_RPCS![0],
  tokenSymbol: 'UNIT',
  tokenDecimals: 12
}

function activeNetwork(): NetworkConfig {
  const genesis = process.env.NETWORK_GENESIS_HASH
  if (genesis === PASEONEXTV2_ASSETHUB.genesisHash) return PASEONEXTV2_ASSETHUB
  return PREVIEWNET_ASSETHUB
}

function activePeopleChain(): NetworkConfig {
  const genesis = process.env.NETWORK_GENESIS_HASH
  if (genesis === PASEONEXTV2_ASSETHUB.genesisHash) return PASEO_PEOPLE
  return PREVIEWNET_PEOPLE
}

export { APP_URL, PORT }

function productAccountMap(accounts: Account[]): Record<string, Account> | undefined {
  const primary = accounts[0]
  if (!primary) return undefined
  return { [`${LOCALHOST_SELF_DOTNS}/0`]: primary }
}

export async function startSignedHost(...accounts: Account[]) {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  const resolved = accounts.length > 0 ? accounts : (['alice'] as Account[])
  return createTestHostServer({
    productUrl: APP_URL,
    accounts: resolved,
    networks: [activeNetwork(), activePeopleChain()],
    productAccounts: productAccountMap(resolved)
  })
}

/**
 * Like {@link startSignedHost} but with explicit product-account mappings,
 * keyed `${dotnsId}/${index}`. Lets a test point a chosen derivation index at a
 * distinct (fundable) account, such as a fresh, never-bound attester that drives
 * the bind-and-attest batch.
 */
export async function startSignedHostWithProductAccounts(
  account: Account,
  productAccounts: Record<string, Account>
) {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  return createTestHostServer({
    productUrl: APP_URL,
    accounts: [account],
    networks: [activeNetwork(), activePeopleChain()],
    productAccounts
  })
}

export async function startUnsignedHost() {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  return createTestHostServer({
    productUrl: APP_URL,
    accounts: [],
    networks: [activeNetwork()]
  })
}

export async function navigateToTestHost(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl, { waitUntil: 'commit' })
  await page.waitForFunction(
    () => !!(window as unknown as { __TEST_HOST__: unknown }).__TEST_HOST__,
    { timeout: 30_000 }
  )
  // A signed host models a logged-in user. Authenticate so getUserId resolves.
  // The identity-binding flow reads the primary username via getUserId.
  await page.evaluate(() =>
    (
      window as unknown as { __TEST_HOST__: { simulateReconnect(): void } }
    ).__TEST_HOST__.simulateReconnect()
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
