/**
 * Synchronization end-to-end tests.
 */

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
    // The product and the host talk over a MessagePort, so that is the bridge
    // to weigh. Init scripts run in the product frame too, and each side counts
    // what it sends.
    await page.addInitScript(() => {
      const counter = { bytes: 0 }
      const sizeOf = (value: unknown, depth = 0): number => {
        if (typeof value === 'string') return value.length
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength
        if (typeof value === 'number' || typeof value === 'boolean') return 8
        if (value === null || value === undefined || depth > 4) return 0
        if (Array.isArray(value)) return value.reduce((n, v) => n + sizeOf(v, depth + 1), 0)
        if (typeof value === 'object') {
          return Object.entries(value as Record<string, unknown>).reduce(
            (n, [k, v]) => n + k.length + sizeOf(v, depth + 1),
            0
          )
        }
        return 0
      }
      const post = MessagePort.prototype.postMessage
      MessagePort.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
        counter.bytes += sizeOf(message)
        return post.apply(this, [message, ...rest] as Parameters<typeof post>)
      }
      ;(window as unknown as { __bridgeBytes: typeof counter }).__bridgeBytes = counter
    })

    // When
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    await page.waitForTimeout(SAMPLE_WINDOW_MS)

    // Then
    const bytesSentBy = (target: { evaluate: typeof page.evaluate }) =>
      target.evaluate(
        () => (window as unknown as { __bridgeBytes?: { bytes: number } }).__bridgeBytes?.bytes ?? 0
      )
    const totalBridgeBytes = (await bytesSentBy(page)) + (await bytesSentBy(frame))

    expect(totalBridgeBytes).toBeLessThan(BRIDGE_TRAFFIC_BUDGET_MB * 1024 * 1024)

    await page.close()
    await context.close()
    await host.close()
  })
})
