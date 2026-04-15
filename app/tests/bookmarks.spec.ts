/**
 * Bookmarks E2E Tests
 *
 * Validates that signed users can star/unstar apps and see them in Bookmarks.
 */

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { getProductFrame, navigateToTestHost, seedAllApps, startSignedHost } from './utils'

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

  test('As Alice, I star an app on the All tab and it appears in Bookmarks', async () => {
    const page = await context.newPage()

    // Given
    await seedAllApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    await frame.waitForSelector('.product-card', { timeout: 10_000 })
    await frame.waitForTimeout(500)
    const firstCard = frame.locator('.product-card').first()
    appName = (await firstCard.locator('.product-card__name').textContent())!

    // When
    await firstCard.locator('.star-button').click()

    // Then
    await expect(firstCard.locator('.star-button')).toHaveClass(/star-button--active/)
    await expect(firstCard.locator('.star-button')).toHaveAttribute('aria-pressed', 'true')

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

  test('As Alice, the starred app persists in Bookmarks after reload', async () => {
    const page = await context.newPage()

    // Given
    await seedAllApps(page)
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

  test('As Alice, I unstar the app and Bookmarks is empty', async () => {
    const page = await context.newPage()

    // Given
    await seedAllApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'Bookmarks' }).click()
    await frame.waitForTimeout(300)

    // When
    await frame.locator('.product-card').first().locator('.star-button').click()
    await frame.waitForTimeout(500)

    // Then
    await expect(frame.locator('.empty-state')).toBeVisible()
    await expect(frame.locator('.product-card')).toHaveCount(0)

    await page.close()
  })

  test('As Alice, the unstarred app stays gone after reload', async () => {
    const page = await context.newPage()

    // Given
    await seedAllApps(page)
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
