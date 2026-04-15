/**
 * App Start E2E Tests
 *
 * Validates the initial state and navigation of browse for signed and unsigned users.
 */

import type { BrowserContext, Frame } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  getProductFrame,
  navigateToTestHost,
  startSignedHost,
  startUnsignedHost
} from './utils'

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
    })

    test('As an unsigned user, I see the browse.dot header', async () => {
      // Then
      const title = frame.locator('.title')
      await expect(title).toBeVisible()
      await expect(title).toContainText('browse.')
      await expect(title).toContainText('dot')
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

    test('As a signed user, the All tab loads a sorted list of apps', async () => {
      test.setTimeout(60_000)
      const page = await context.newPage()
      await navigateToTestHost(page, host.url)
      const frame = await getProductFrame(page, '.category-tab')

      // When
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await expect(frame.locator('.loading-dots')).toBeVisible()
      await frame.waitForSelector('.product-card', { timeout: 50_000 })
      await expect(frame.locator('.product-card').first()).toBeVisible()
      const names = await frame.locator('.product-card__name').allTextContents()
      expect(names.length).toBeGreaterThan(0)
      const sorted = [...names].sort((a, b) => a.localeCompare(b))
      expect(names).toEqual(sorted)

      await page.close()
    })

    test('As a signed user, cached All apps show on reload with loading indicator', async () => {
      test.setTimeout(60_000)
      const page = await context.newPage()
      await navigateToTestHost(page, host.url)
      const frame = await getProductFrame(page, '.category-tab')

      // When
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await expect(frame.locator('.product-card').first()).toBeVisible()
      await expect(frame.locator('.loading-dots')).toBeVisible()

      await page.close()
    })
  })
})
