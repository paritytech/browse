import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'

import { DOMAINS_SNAPSHOT_CID } from './fixtures/domains-snapshot'
import { USERNAMES_SNAPSHOT_CID } from './fixtures/usernames-snapshot'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? '5173'

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  timeout: 10_000,
  retries: 0,
  use: {
    browserName: 'chromium',
    headless: process.env.HEADED !== '1',
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    launchOptions: {
      slowMo: process.env.SLOW_MO ? Number(process.env.SLOW_MO) : undefined,
      args: [
        '--disable-features=PrivateNetworkAccessRespectPreflightResults,ThirdPartyStoragePartitioning',
        '--disable-web-security'
      ]
    }
  },
  webServer: {
    command: `bunx vite --port ${PORT}`,
    cwd: resolve(__dirname, '..'),
    port: Number(PORT),
    reuseExistingServer: true,
    timeout: 30_000,
    // Vite exposes prefixed shell env as import.meta.env, so the client reads
    // these as the active snapshots. Only the matching snapshot test seeds the
    // blocks, so other tests just see an empty snapshot.
    env: {
      APP_DOMAINS_SNAPSHOT_CID: DOMAINS_SNAPSHOT_CID,
      APP_USERNAMES_SNAPSHOT_CID: USERNAMES_SNAPSHOT_CID
    }
  },
  reporter: [['list'], ['json', { outputFile: resolve(__dirname, 'results/results.json') }]]
})
