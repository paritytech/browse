import { blake2b } from '@noble/hashes/blake2.js'
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

import { LOCALHOST_SELF_DOTNS, NETWORK } from '../src/lib/config'
import { persistProductStorage } from './fixtures/host-storage'

const PORT = process.env.PORT ?? '5173'
const APP_URL = `http://localhost:${PORT}`

// smalltava.08
export const DEV_PHRASE =
  'give social ivory used surprise dignity mother boss sword lunar giggle icon'

/**
 * Returns the run-unique id shared by the identity entropy and username, or
 * undefined locally. A re-run of a CI job keeps its run id, so a later attempt
 * gets its own: the attestations an earlier attempt made from its product
 * account cannot be revoked by the suite and would refuse every recommend.
 */
function runId(): string | undefined {
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? 1)
  const id = process.env.GITHUB_RUN_ID ?? process.env.E2E_RUN_ID
  return id && attempt > 1 ? `${id}-${attempt}` : id
}

/**
 * The 32 bytes of BIP-39 entropy that the session of the per-run identity
 * activates from.
 *
 * Each CI run gets a unique identity so a dead account leaving a stuck
 * one-per-identity lock on one run never blocks another, and concurrent runs
 * never contend on the same identity. playwright.config.ts gives local runs an
 * id too, so only a fixture script run by hand falls back to a shared one.
 *
 * The host activates a session from entropy, not a derivation path, so the run
 * id is hashed into the entropy.
 */
export function identityEntropy(): Uint8Array {
  return blake2b(new TextEncoder().encode(`browse-e2e:identity:${runId() ?? 'local'}`), {
    dkLen: 32
  })
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

// The test host reads the role of each chain off the id suffix, -asset-hub or
// -people, so the network name goes first.
const PASEONEXTV2_ASSETHUB: NetworkConfig = {
  id: 'paseo-next-v2-asset-hub',
  name: 'Paseo AssetHubNextV2',
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
  id: 'paseo-next-v2-people',
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

// Stops compiling once the test host server takes `networks`, the release that
// closes paritytech/trinity-user-agents#1388. Then drop every workaround for it:
// - fromNetworks in startSignedHost here, startHost in apps/portal/tests/utils.ts
//   and scripts/mock-host.ts
// - the remount after seedIconPreimage in app-start.spec.ts
// - the seeding in fixtures/host-storage.ts
true satisfies 'networks' extends keyof TestHostServerOptions ? never : true

/**
 * Start a test host signed in as the first of `accounts`, `alice` by default.
 *
 * The server takes no `networks`, so they are expanded here into the chain
 * proxies and runtime config they stand for. Tracked in
 * paritytech/trinity-user-agents#1388. `networkSuffix` is the dotNS TLD of the
 * active network, which the identity account derives under as
 * createIdentitySigner does, so it is set here rather than left to the host
 * default.
 */
export async function startSignedHost(...accounts: (DevAccountName | DevAccount)[]) {
  const { createTestHostServer } = await import('@parity/truapi-host/testing/server')
  const { fromNetworks } = await import('@parity/truapi-host/testing/playwright')
  const { mock, runtimeConfig } = fromNetworks([activeNetwork(), activePeopleChain()])
  return createTestHostServer({
    productUrl: APP_URL,
    productId: LOCALHOST_SELF_DOTNS,
    accounts: accounts.length > 0 ? accounts : ['alice'],
    mock,
    runtimeConfig: { ...runtimeConfig, networkSuffix: NETWORK.TLD }
  })
}

/**
 * A host for the specs written against a user with no connected account.
 *
 * It is signed in on purpose: these specs assert what holds for a connected
 * user too, and the signed-out path of the sign-in detection in the app is not
 * tested here. A host booted with `loginBehavior: 'manual'` would cover it.
 */
export async function startUnsignedHost() {
  return startSignedHost('alice')
}

export async function navigateToTestHost(page: Page, hostUrl: string): Promise<void> {
  // The test host loses its product storage on every load, so mirror it.
  await persistProductStorage(page)
  await page.goto(hostUrl, { waitUntil: 'commit' })
  // The host mints the session for the active account itself, and getUserId
  // reports the username of that account, so nothing has to be reconnected.
  await page.waitForFunction(
    () => !!(window as unknown as { __TEST_HOST__: unknown }).__TEST_HOST__,
    { timeout: 30_000 }
  )
}

export async function getProductFrame(
  page: Page,
  readySelector = '.product-card',
  timeoutMs = 90_000
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs
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
