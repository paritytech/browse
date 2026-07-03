import { readFileSync } from 'node:fs'

import type { Page } from '@playwright/test'

import type { AppCertificate } from '../../src/state/apps/types'

const SEED_STORE_ADDRESS = '0x000000000000000000000000000000000e2e7e57'

const SEED_LABEL_ENTRIES = [
  {
    label: 'calculator',
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
    label: 'stopwatch',
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
  certificate: AppCertificate | null
}>

/**
 * Seed the cache into the host page's localStorage so cards render
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
  const fetchedAt = Date.now()
  const seeded = SEED_LABEL_ENTRIES.map((l) => ({
    ...l,
    ...(options.overrides?.[l.label] ?? {}),
    fetchedAt,
    // Seeded apps stand in for the Publisher set, so they belong in the All tab.
    published: true
  }))
  const orphans = (options.orphans ?? []).map((l) => ({ ...l, fetchedAt }))
  const allLabels = [...seeded, ...orphans]
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

/**
 * Seed the host localStorage from a captured cache snapshot.
 *
 * The snapshot is curated to the keys the live app actually reads (just
 * `browse:labels` today — `browse:stores`/`addresses`/`pcf` belong to the
 * unwired dotns path), so it's seeded verbatim.
 *
 * Pass `staleLabels: true` to rewrite every label's `fetchedAt` to >24h old
 * so the TTL refresh fires on the next sync. Registers an init script — call
 * before navigation.
 */
export async function seedCacheFromSnapshot(
  page: Page,
  snapshotPath: string,
  staleLabels = false
): Promise<void> {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, unknown>

  if (staleLabels && Array.isArray(snapshot['browse:labels'])) {
    const stale = Date.now() - 25 * 3_600_000
    snapshot['browse:labels'] = (snapshot['browse:labels'] as Array<{ fetchedAt?: number }>).map(
      (l) => ({ ...l, fetchedAt: stale })
    )
  }

  await page.addInitScript((data) => {
    for (const [k, v] of Object.entries(data)) {
      localStorage.setItem(`test-host:${k}`, JSON.stringify(v))
    }
  }, snapshot)
}
