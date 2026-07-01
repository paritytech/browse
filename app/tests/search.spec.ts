/**
 * Search E2E tests.
 *
 * Covers the search user stories in this suite:
 *   1. A match on the selected tab shows its card instantly.
 *   2. Searching deselects the tabs and shows the card in the unified list.
 *   3. A `.dot` name not loaded in any tab resolves to a card after a debounce.
 *   4. A name that resolves to nothing shows "No products matching" and a "Try X.dot anyway" action.
 */

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createCachedApps } from './fixtures/cache'
import { getProductFrame, navigateToTestHost, startUnsignedHost } from './utils'

const DEBOUNCE_MS = 500

test.describe('Search', () => {
  let host: Awaited<ReturnType<typeof startUnsignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    host = await startUnsignedHost()
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    // Warm the dev server: vite optimizes deps on the first page load and
    // reloads mid-render, which would drop the first test's fill/Enter. Load
    // once up front so the real tests run against a warm, stable bundle.
    const warm = await context.newPage()
    await navigateToTestHost(warm, host.url)
    await getProductFrame(warm, '.category-tab')
    await warm.close()
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As an un/signed user, when I search for an app that exists on the selected tab, a product card shows instantly', async () => {
    test.setTimeout(20_000)
    // Given
    const page = await context.newPage()
    await createCachedApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    await frame.waitForSelector('.product-card', { timeout: 10_000 })

    // When
    await frame.locator('.search-bar__input').fill('calc')
    // Then
    const card = frame.locator('.product-card[data-label="calculator"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(frame.locator('.product-card')).toHaveCount(1)
    // The `.dot` domain surfaces as the card's native hover tooltip.
    await expect(card).toHaveAttribute('title', 'Open calculator.dot')

    await page.close()
  })

  test('As an un/signed user, when I search for an app, the tabs deselect and the card appears in the unified list', async () => {
    const page = await context.newPage()
    await createCachedApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // Given
    await frame.locator('.category-tab', { hasText: 'Bookmarks' }).click()
    await frame.waitForTimeout(300)

    // When
    await frame.locator('.search-bar__input').fill('calc')
    await frame.waitForTimeout(DEBOUNCE_MS + 200)

    // Then
    await expect(frame.locator('.category-tab--active')).toHaveCount(0)
    await expect(frame.locator('.product-card[data-label="calculator"]')).toBeVisible()

    await page.close()
  })

  test('As an un/signed user, when I search for a .dot name not loaded in any tab, a product card appears after a debounce', async () => {
    // Given
    const page = await context.newPage()
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.search-bar__input').fill('host-playground44')
    // Then
    const card = frame.locator('.product-card[data-label="host-playground44"]')
    await expect(card).toBeVisible({ timeout: 15_000 })

    await page.close()
  })

  test('As an un/signed user, when I search for a name that does not resolve, I see "No products matching" and a "Try X.dot anyway"', async () => {
    // Given
    const page = await context.newPage()
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.search-bar__input').fill('nonexistent-xyz.dot')
    await frame.waitForTimeout(DEBOUNCE_MS + 500)

    // Then
    await expect(frame.locator('.empty-state__text')).toContainText(
      'No products matching "nonexistent-xyz.dot"'
    )
    await expect(frame.locator('.empty-state__btn-ghost')).toContainText(
      'Try nonexistent-xyz.dot anyway'
    )
    await expect(frame.locator('.empty-state__btn-ghost')).not.toContainText('.dot.dot')
    await expect(frame.locator('.product-card')).toHaveCount(0)

    await page.close()
  })
})
