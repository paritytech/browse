/**
 * Search E2E Tests
 *
 * Validates search behaviour across the user stories:
 *   1. Match in selected tab → card shows instantly.
 *   2. Match in another tab  → "Also found in <tab>" hint.
 *   3. No match in any tab, but resolvable via the labels cache → card appears after debounce.
 *   4. No match anywhere and not resolvable → "No products matching" + "Visit X.dot anyway".
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
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As an un/signed user, when I search for an app that exists on the selected tab, the card shows instantly', async () => {
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
    const matched = frame.locator('.product-card[data-label="calculator"]')
    await expect(matched).toBeVisible()
    await expect(frame.locator('.product-card')).toHaveCount(1)

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

  test('As an un/signed user, when I search for a .dot name not loaded in any tab, the card appears after a debounce', async () => {
    // Given
    const page = await context.newPage()
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.search-bar__input').fill('host-playground44')

    // Then
    const resolvedCard = frame.locator('.product-card[data-label="host-playground44"]')
    await expect(resolvedCard).toBeVisible({ timeout: 15_000 })

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
