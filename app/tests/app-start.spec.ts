/**
 * App Start E2E Tests
 *
 * Validates the initial state and navigation of browse for signed and unsigned users.
 */

import type { BrowserContext, Frame } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createCachedApps } from './fixtures/cache'
import { getProductFrame, navigateToTestHost, startSignedHost, startUnsignedHost } from './utils'

test.describe('App Start', () => {
  test.describe('unsigned user', () => {
    let host: Awaited<ReturnType<typeof startUnsignedHost>>
    let context: BrowserContext
    let frame: Frame

    test.beforeAll(async ({ browser }) => {
      host = await startUnsignedHost()
      context = await browser.newContext({ ignoreHTTPSErrors: true })
      const page = await context.newPage()
      await navigateToTestHost(page, host.url)
      frame = await getProductFrame(page, '.category-tab')
    })

    test.afterAll(async () => {
      await context?.close()
      await host?.close()
    })

    test('As an unsigned user, I see 3 tabs', async () => {
      // Then
      const tabs = frame.locator('.category-tab')
      expect(await tabs.count()).toBe(3)
      const tabLabels = await tabs.allTextContents()
      expect(tabLabels).toEqual(['PCF', 'Bookmarks', 'All'])

      // Then
      const activeTab = frame.locator('.category-tab--active')
      await expect(activeTab).toHaveText('PCF')
    })

    test('As an unsigned user, the PCF tab loads apps on start', async () => {
      // Then
      await expect(frame.locator('.loading-dots')).toBeVisible()
      const cards = frame.locator('.product-card')
      await expect(cards.first()).toBeVisible({ timeout: 10_000 })
      expect(await cards.count()).toBeGreaterThan(0)
      await expect(frame.locator('.loading-dots')).not.toBeVisible()

      // When
      const reloaded = await context.newPage()
      await navigateToTestHost(reloaded, host.url)
      const reloadedFrame = await getProductFrame(reloaded, '.category-tab')

      // Then
      await expect(reloadedFrame.locator('.product-card').first()).toBeVisible()
      await expect(reloadedFrame.locator('.loading-dots')).not.toBeVisible()

      await reloaded.close()
    })

    test('As an unsigned user, I see the browse header', async () => {
      // Then
      const title = frame.locator('.title')
      await expect(title).toBeVisible()
      await expect(title).toContainText('browse')
    })

    test('As an unsigned user, I see the search bar', async () => {
      // Then
      await expect(frame.locator('.search-bar input')).toBeVisible()
    })

    test('As an unsigned user, Bookmarks tab shows empty state by default', async () => {
      // When
      await frame.locator('.category-tab', { hasText: 'Bookmarks' }).click()

      // Then
      await expect(frame.locator('.empty-state')).toBeVisible()
      await expect(frame.locator('.product-card')).toHaveCount(0)
    })
  })

  test.describe('signed user', () => {
    let host: Awaited<ReturnType<typeof startSignedHost>>
    let context: BrowserContext
    let frame: Frame

    test.beforeAll(async ({ browser }) => {
      host = await startSignedHost('alice')
      context = await browser.newContext({ ignoreHTTPSErrors: true })
      const page = await context.newPage()
      await navigateToTestHost(page, host.url)
      frame = await getProductFrame(page, '.category-tab')
    })

    test.afterAll(async () => {
      await context?.close()
      await host?.close()
    })

    test('As a signed user, I see 4 tabs', async () => {
      // Then
      const tabs = frame.locator('.category-tab')
      expect(await tabs.count()).toBe(4)
      const tabLabels = await tabs.allTextContents()
      expect(tabLabels).toEqual(['PCF', 'Bookmarks', 'Following', 'All'])

      // Then
      const activeTab = frame.locator('.category-tab--active')
      await expect(activeTab).toHaveText('PCF')
    })

    test('As a un/signed user, the All tab loads a sorted list of apps', async () => {
      test.setTimeout(45_000)

      // When
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await expect(frame.locator('.product-card')).toHaveCount(0)
      await expect(frame.locator('.loading-dots')).toBeVisible()
      await frame.waitForSelector('.product-card', { timeout: 50_000 })
      await expect(frame.locator('.product-card').first()).toBeVisible()
      const names = await frame.locator('.product-card__name').allTextContents()
      expect(names.length).toBeGreaterThan(1)
      const sorted = [...names].sort((a, b) => a.localeCompare(b))
      expect(names).toEqual(sorted)

      // Then
      const { labelCount, storeCount } = await frame.page().evaluate(() => {
        const labels = localStorage.getItem('test-host:browse:labels')
        const stores = localStorage.getItem('test-host:browse:stores')
        return {
          labelCount: labels ? (JSON.parse(labels) as unknown[]).length : 0,
          storeCount: stores ? (JSON.parse(stores) as unknown[]).length : 0
        }
      })
      expect(labelCount).toBeGreaterThan(1)
      expect(storeCount).toBeGreaterThan(0)
    })

    test('As a un/signed user, cached label metadata older than the TTL is refreshed (and fresh entries are not)', async () => {
      test.setTimeout(45_000)
      const page = await context.newPage()

      // Given
      const STALE_TS = Date.now() - 25 * 3_600_000
      const FRESH_TS = Date.now() - 60_000
      await page.addInitScript(
        ({ stale, fresh }) => {
          const labels = [
            {
              label: 'e2e-stale-test',
              name: 'Outdated',
              description: 'Old',
              contentHash: 'ipfs://outdated',
              attestationCount: 0,
              hasUserAttested: false,
              fetchedAt: stale
            },
            {
              label: 'e2e-fresh-test',
              name: 'Recent',
              description: 'New',
              contentHash: 'ipfs://recent',
              attestationCount: 0,
              hasUserAttested: false,
              fetchedAt: fresh
            }
          ]
          localStorage.setItem('test-host:browse:labels', JSON.stringify(labels))
        },
        { stale: STALE_TS, fresh: FRESH_TS }
      )
      await navigateToTestHost(page, host.url)
      const frame = await getProductFrame(page, '.category-tab')

      // When
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await page.waitForFunction(
        (stale) => {
          const labels = JSON.parse(
            localStorage.getItem('test-host:browse:labels') ?? '[]'
          ) as Array<{ label: string; fetchedAt?: number }>
          const entry = labels.find((l) => l.label === 'e2e-stale-test')
          return entry !== undefined && (entry.fetchedAt ?? 0) > stale
        },
        STALE_TS,
        { timeout: 30_000 }
      )

      // Then
      const freshEntryTs = await page.evaluate(() => {
        const labels = JSON.parse(
          localStorage.getItem('test-host:browse:labels') ?? '[]'
        ) as Array<{ label: string; fetchedAt?: number }>
        return labels.find((l) => l.label === 'e2e-fresh-test')?.fetchedAt
      })
      expect(freshEntryTs).toBe(FRESH_TS)

      await page.close()
    })

    test('As a signed user, cached All apps show instantly on reload while syncing in the background', async () => {
      test.setTimeout(45_000)
      const page = await context.newPage()
      await navigateToTestHost(page, host.url)
      let frame: Frame = await getProductFrame(page, '.category-tab')

      // Given
      await createCachedApps(page)
      await page.reload({ waitUntil: 'commit' })
      frame = await getProductFrame(page, '.category-tab')

      // When
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await expect(frame.locator('.product-card').first()).toBeVisible()
      await expect(frame.locator('.loading-dots')).toBeVisible()
      await expect(frame.locator('.product-card').nth(3)).toBeVisible({ timeout: 90_000 })

      // Then
      const { labelCount, storeCount } = await page.evaluate(() => {
        const labels = localStorage.getItem('test-host:browse:labels')
        const stores = localStorage.getItem('test-host:browse:stores')
        return {
          labelCount: labels ? (JSON.parse(labels) as unknown[]).length : 0,
          storeCount: stores ? (JSON.parse(stores) as unknown[]).length : 0
        }
      })
      expect(labelCount).toBeGreaterThan(3)
      expect(storeCount).toBeGreaterThan(0)

      await page.close()
    })
  })
})
