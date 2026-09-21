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

/**
 * The host uri of the per-run identity: hard junctions under the dev seed, which
 * is all the test host derives from. {@link identityPath} names the same key
 * the fixtures sign with (see createProductSigner).
 */
export function identityUri(): string {
  return identityPath()
}

/**
 * The username the per-run identity registers for itself and reveals on a
 * first recommendation. A base of lowercase letters, as the People chain
 * wants it, that encodes the run id, so every run registers a fresh one and
 * the `.10` suffix is always free.
 */
export function identityUsername(): string {
  const id = runId() ?? 'local'
  const base = id
    .replace(/[^a-z]/gi, (c) => (/\d/.test(c) ? String.fromCharCode(97 + Number(c)) : ''))
    .toLowerCase()
  return `run${base}.10`
}

type Account = import('@parity/host-api-test-sdk').Account
type NetworkConfig = import('@parity/host-api-test-sdk').NetworkConfig

const PASEONEXTV2_ASSETHUB: NetworkConfig = {
  id: 'paseo-asset-hub-next-v2',
  name: 'Paseo AssetHubNextV2',
  genesisHash: PASEONEXTV2_ASSETHUB_GENESIS,
  rpcUrl: KNOWN_NETWORKS[PASEONEXTV2_ASSETHUB_GENESIS].ASSETHUB_RPCS[0],
  tokenSymbol: 'PAS',
  tokenDecimals: 10,
  chain: 'AssetHub'
}

const PREVIEWNET_ASSETHUB: NetworkConfig = {
  id: 'previewnet-asset-hub',
  name: 'Previewnet AssetHub',
  genesisHash: PREVIEWNET_ASSETHUB_GENESIS,
  rpcUrl: KNOWN_NETWORKS[PREVIEWNET_ASSETHUB_GENESIS].ASSETHUB_RPCS[0],
  tokenSymbol: 'UNIT',
  tokenDecimals: 12,
  chain: 'AssetHub'
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
  // The host maps a product's whole account subtree, keyed by the bare id.
  return { [LOCALHOST_SELF_DOTNS]: primary }
}

export async function startSignedHost(...accounts: Account[]) {
  const { createTestHostServer } = await import('@parity/host-api-test-sdk')
  const resolved = accounts.length > 0 ? accounts : (['alice'] as Account[])
  return createTestHostServer({
    productUrl: APP_URL,
    productId: LOCALHOST_SELF_DOTNS,
    accounts: resolved,
    networks: [activeNetwork(), activePeopleChain()],
    productAccounts: productAccountMap(resolved)
  })
}

/**
 * Like {@link startSignedHost} but with explicit product-account mappings,
 * keyed by bare product id. Lets a test point the app's account subtree at a
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
    productId: LOCALHOST_SELF_DOTNS,
    accounts: [account],
    networks: [activeNetwork(), activePeopleChain()],
    productAccounts
  })
}

/**
 * A host for the specs written against a user with no connected account.
 *
 * host-api-test-sdk 0.13 always mints a session for its first roster entry
 * and refuses an empty roster, so a disconnected account cannot be modelled
 * any more; the old page rewrite that left the account request pending has
 * nothing to rewrite. The specs' assertions hold for a connected user too, so
 * until the host can present a disconnected one this is the signed host.
 */
export async function startUnsignedHost() {
  return startSignedHost('alice')
}

export async function navigateToTestHost(page: Page, hostUrl: string): Promise<void> {
  await page.goto(hostUrl, { waitUntil: 'commit' })
  // The host mints the session for the active account itself, and getUserId
  // reports that account's username, so nothing has to be reconnected.
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
      // The app disables the category tabs while `coldStart` holds, which is
      // until the first sync has something to show. Handing back a frame before
      // they go live means the next tab click waits out the whole test budget
      // and then reports "Target page, context or browser has been closed".
      if ((await productFrame.locator('.category-tab').count()) > 0) {
        await productFrame.waitForSelector('.category-tab:not([disabled])', {
          timeout: Math.min(30_000, deadline - Date.now())
        })
      }
      return productFrame
    } catch {
      await page.waitForTimeout(500)
    }
  }
  throw new Error(`Could not find product frame with "${readySelector}" ready`)
}
