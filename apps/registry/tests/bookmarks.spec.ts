/**
 * Bookmarks E2E Tests
 *
 * Validates that signed users can bookmark/unbookmark apps and see them in
 * Bookmarks. The bookmark toggle is an inline icon button on each card.
 */

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createCachedApps } from './fixtures/cache'
import { getProductFrame, navigateToTestHost, startSignedHost } from './utils'

test.describe('Bookmarks', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext
  let appName: string

  test.beforeAll(async ({ browser }) => {
    host = await startSignedHost('alice')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As Alice, when I bookmark an app, it shows up in Bookmarks', async () => {
    const page = await context.newPage()

    // Given
    await createCachedApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    await frame.waitForSelector('.product-card', { timeout: 10_000 })
    await frame.waitForTimeout(500)
    const firstCard = frame.locator('.product-card').first()
    appName = (await firstCard.locator('.product-card__name').textContent())!

    // When
    await firstCard.locator('.product-card__bookmark').click()
    await expect(firstCard.locator('.product-card__bookmark--active')).toBeVisible()

    // When
    await frame.locator('.category-tab', { hasText: 'Bookmarks' }).click()
    await frame.waitForTimeout(300)

    // Then
    await expect(frame.locator('.product-card')).toHaveCount(1)
    await expect(frame.locator('.product-card').first().locator('.product-card__name')).toHaveText(
      appName
    )

    await page.close()
  })

  test('As Alice, the bookmarked app persists in Bookmarks after reload', async () => {
    const page = await context.newPage()

    // Given
    await createCachedApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.category-tab', { hasText: 'Bookmarks' }).click()
    await frame.waitForTimeout(300)

    // Then
    await expect(frame.locator('.product-card')).toHaveCount(1)
    await expect(frame.locator('.product-card').first().locator('.product-card__name')).toHaveText(
      appName
    )

    await page.close()
  })

  test('As Alice, I remove the bookmark and Bookmarks is empty', async () => {
    const page = await context.newPage()

    // Given
    await createCachedApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'Bookmarks' }).click()
    await frame.waitForTimeout(300)

    // When
    await frame.locator('.product-card').first().locator('.product-card__bookmark').click()
    await frame.waitForTimeout(500)

    // Then
    await expect(frame.locator('.empty-state')).toBeVisible()
    await expect(frame.locator('.product-card')).toHaveCount(0)

    await page.close()
  })

  test('As Alice, the un-bookmarked app stays gone after reload', async () => {
    const page = await context.newPage()

    // Given
    await createCachedApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.category-tab', { hasText: 'Bookmarks' }).click()
    await frame.waitForTimeout(300)

    // Then
    await expect(frame.locator('.empty-state')).toBeVisible()
    await expect(frame.locator('.product-card')).toHaveCount(0)

    await page.close()
  })
})
