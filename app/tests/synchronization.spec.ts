import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

import { seedCacheFromSnapshot } from './fixtures/cache'
import { getProductFrame, navigateToTestHost, startSignedHost } from './utils'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = resolve(__dirname, 'snapshots', 'local-storage-20260601.json')
const SAMPLE_WINDOW_MS = 60_000
const BRIDGE_TRAFFIC_BUDGET_MB = 5

test.describe('Synchronization', () => {
  test('As a returning user I want to synchronize my local storage with the cloud with under than 5MB traffic going through the host bridge per minute.', async ({
    browser
  }) => {
    test.setTimeout(180_000)

    const host = await startSignedHost('alice')
    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await context.newPage()

    // Given
    await seedCacheFromSnapshot(page, SNAPSHOT_PATH, true)
    await page.addInitScript(() => {
      const proto = window.Storage.prototype
      const origSet = proto.setItem
      const origGet = proto.getItem
      const counter = { bytes: 0 }
      proto.setItem = function (k: string, v: string) {
        if (k.startsWith('test-host:')) counter.bytes += k.length + v.length
        return origSet.call(this, k, v)
      }
      proto.getItem = function (k: string) {
        const v = origGet.call(this, k)
        if (k.startsWith('test-host:') && v) counter.bytes += k.length + v.length
        return v
      }
      ;(window as unknown as { __bridgeBytes: typeof counter }).__bridgeBytes = counter
    })

    // When
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    await page.waitForTimeout(SAMPLE_WINDOW_MS)

    // Then
    const totalBridgeBytes = await page.evaluate(
      () => (window as unknown as { __bridgeBytes: { bytes: number } }).__bridgeBytes.bytes
    )

    expect(totalBridgeBytes).toBeLessThan(BRIDGE_TRAFFIC_BUDGET_MB * 1024 * 1024)

    await page.close()
    await context.close()
    await host.close()
  })
})
