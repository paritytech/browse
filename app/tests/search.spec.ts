/**
 * Search E2E tests.
 */

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { nameWithTld } from '@parity/browse-sdk'

import { NETWORK } from '../src/lib/config'
import { createCachedApps } from './fixtures/cache'
import { SNAPSHOT_BLOCKS, SNAPSHOT_ONLY_LABEL } from './fixtures/domains-snapshot'
import { seedPreimage } from './fixtures/seed-preimage'
import { getProductFrame, navigateToTestHost, startUnsignedHost } from './utils'

const DEBOUNCE_MS = 500

// The suffix this network appends, so the typing cases exercise the real one.
const SUFFIX = `.${NETWORK.TLD}`

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
    await expect(
      frame.locator('.product-card--placeholder, .product-card[data-label="calc"]')
    ).toHaveCount(1)
    await expect(card).toHaveAttribute('title', `Open ${nameWithTld('calculator', NETWORK.TLD)}`)

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

  test('As an un/signed user, when I search for a name not loaded in any tab, a product card appears after a debounce', async () => {
    // Given
    const page = await context.newPage()
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.search-bar__input').fill('alarm-clock')
    // Then
    const card = frame.locator('.product-card[data-label="alarm-clock"]')
    await expect(card).toBeVisible({ timeout: 15_000 })

    await page.close()
  })

  test("As an un/signed user, when I type 2 or more characters in the search bar, I see every app on the network whose name starts with those characters, so that I can discover and open apps I didn't know existed without typing their exact full name", async () => {
    // Given
    const page = await context.newPage()
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    for (const block of SNAPSHOT_BLOCKS) await seedPreimage(page, block)

    // When
    await frame.locator('.search-bar__input').fill('zz')

    // Then
    const card = frame.locator(`.product-card[data-label="${SNAPSHOT_ONLY_LABEL}"]`)
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.locator('.product-card__name')).toHaveText(
      nameWithTld(SNAPSHOT_ONLY_LABEL, NETWORK.TLD)
    )

    await page.close()
  })

  test('As an un/signed user, when I search for a name that does not resolve, I still get a card for the address', async () => {
    // Given
    const page = await context.newPage()
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.search-bar__input').fill(`nonexistent-xyz${SUFFIX}`)
    await frame.waitForTimeout(DEBOUNCE_MS + 500)

    // Then
    const placeholder = frame.locator('.product-card--placeholder')
    await expect(placeholder).toHaveCount(1)
    await expect(placeholder.locator('.product-card__name')).toHaveText(`nonexistent-xyz${SUFFIX}`)
    await expect(placeholder.locator('.product-card__name')).not.toContainText(`${SUFFIX}${SUFFIX}`)
    await expect(frame.locator('.empty-state')).toHaveCount(0)

    // When
    await frame.locator('.search-bar__input').fill('nonexistent-xyz.')

    // Then
    await expect(placeholder).toHaveCount(1)

    // When
    await frame.locator('.search-bar__input').fill('nonexistent-xyz-')

    // Then
    await expect(placeholder).toHaveCount(1)
    await expect(placeholder.locator('.product-card__name')).toHaveText(`nonexistent-xyz-${SUFFIX}`)

    await page.close()
  })
})
