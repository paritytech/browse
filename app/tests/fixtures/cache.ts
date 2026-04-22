import type { Page } from '@playwright/test'

const SEED_STORE_ADDRESS = '0x000000000000000000000000000000000e2e7e57'

const SEED_LABEL_ENTRIES = [
  {
    label: 'e2e-test-app-alpha',
    name: 'Alpha App',
    description: 'First test app',
    contentHash: 'ipfs://QmE2eTestAlpha',
    attestationCount: 0,
    hasUserAttested: false
  },
  {
    label: 'e2e-test-app-beta',
    name: 'Beta App',
    description: 'Second test app',
    contentHash: 'ipfs://QmE2eTestBeta',
    attestationCount: 0,
    hasUserAttested: false
  },
  {
    label: 'e2e-test-app-gamma',
    name: 'Gamma App',
    description: 'Third test app',
    contentHash: 'ipfs://QmE2eTestGamma',
    attestationCount: 0,
    hasUserAttested: false
  }
]

// Labels seeded into the labels blob but NOT attached to any store — they
// don't show up in any tab's filtered list, but `resolveLabel` finds them
// via the labels-cache fast path. Used by the search-resolve test.
export interface OrphanLabel {
  label: string
  name: string | null
  description: string
  contentHash: string
  attestationCount: number | null
  hasUserAttested: boolean
}

export type LabelOverride = Partial<{
  attestationCount: number | null
  hasUserAttested: boolean
}>

/**
 * Seed the All apps cache into the host page's localStorage so cards render
 * immediately on the next navigation/reload without waiting for the on-chain
 * scan. Registers an init script — call before the navigation you want to
 * affect.
 *
 * The app's storage layer (`lib/local-storage.ts`) routes through
 * `hostLocalStorage` when inside an iframe, which the test-host-sdk bridges
 * to the host page's `localStorage` under the `test-host:` prefix. We also
 * write the bare keys for the non-hosted (direct APP_URL) case.
 */
export async function createCachedApps(
  page: Page,
  options: {
    overrides?: Record<string, LabelOverride>
    orphans?: OrphanLabel[]
  } = {}
): Promise<void> {
  const seeded = SEED_LABEL_ENTRIES.map((l) => ({ ...l, ...(options.overrides?.[l.label] ?? {}) }))
  const allLabels = [...seeded, ...(options.orphans ?? [])]
  const stores = [
    {
      storeAddress: SEED_STORE_ADDRESS,
      ownerH160Address: null,
      ownerSS58Address: 'e2e-test-owner',
      labels: SEED_LABEL_ENTRIES.map((l) => l.label)
    }
  ]
  await page.addInitScript(
    ({ labels, stores }) => {
      const write = (prefix: string) => {
        localStorage.setItem(`${prefix}browse:labels`, JSON.stringify(labels))
        localStorage.setItem(`${prefix}browse:stores`, JSON.stringify(stores))
      }
      write('test-host:')
      write('')
    },
    { labels: allLabels, stores }
  )
}
