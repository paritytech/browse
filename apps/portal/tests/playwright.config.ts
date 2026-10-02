import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'

import { buildSnapshotFixture } from './snapshot-fixture'
import { activeGenesis } from './utils'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Must match the default in utils.ts, which explains the off-5173 choice.
const PORT = process.env.PORT ?? '5273'

// Point the app at the snapshot fixture the specs seed. The vite web server
// inherits this env, so suggestions resolve against the seeded preimages.
process.env.APP_DOMAINS_SNAPSHOT_CID ??= buildSnapshotFixture(activeGenesis()).manifestCid

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  // Live network reads and three parallel host handshakes flake under load.
  // One retry keeps a real regression red while reporting hiccups as flaky.
  retries: 1,
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
    timeout: 30_000
  },
  reporter: [['list'], ['json', { outputFile: resolve(__dirname, 'results/results.json') }]]
})
