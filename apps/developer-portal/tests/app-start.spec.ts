/**
 * Verifies the developer portal loads inside the Parity host and its core
 * navigation works without chain state.
 *
 * Uses the host-api-test-sdk to stand up a mock host around the app.
 */

import type { BrowserContext, Frame, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { getProductFrame, navigateToTestHost, startUnsignedHost } from './utils'

test.describe('Developer portal', () => {
  let host: Awaited<ReturnType<typeof startUnsignedHost>>
  let context: BrowserContext
  let page: Page
  let frame: Frame

  test.beforeAll(async ({ browser }) => {
    host = await startUnsignedHost()
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    page = await context.newPage()
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.toolbar')
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('loads inside the host with the Products sidebar and toolbar', async () => {
    // Then
    await expect(frame.locator('.nav-item', { hasText: 'Products' })).toBeVisible()
    await expect(frame.locator('.nav-item', { hasText: 'Certificates' })).toBeVisible()
    await expect(frame.getByRole('button', { name: 'Add new' })).toBeVisible()
    await expect(frame.locator('.search input')).toBeVisible()
  })

  test('shows the empty products state before any domain is added', async () => {
    // Then
    await expect(frame.locator('.empty-state')).toBeVisible()
    await expect(frame.locator('.card')).toHaveCount(0)
  })

  test('the view toggle reports its pressed state', async () => {
    // When
    await frame.getByRole('button', { name: 'List view' }).click()

    // Then
    await expect(frame.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(frame.getByRole('button', { name: 'Grid view' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    // When
    await frame.getByRole('button', { name: 'Grid view' }).click()

    // Then
    await expect(frame.getByRole('button', { name: 'Grid view' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('the host theme flips the document theme attribute', async () => {
    // When
    await page.evaluate(() => {
      ;(
        window as unknown as { __TEST_HOST__: { setTheme(theme: 'light' | 'dark'): void } }
      ).__TEST_HOST__.setTheme('dark')
    })

    // Then
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'berlinNight')

    // When
    await page.evaluate(() => {
      ;(
        window as unknown as { __TEST_HOST__: { setTheme(theme: 'light' | 'dark'): void } }
      ).__TEST_HOST__.setTheme('light')
    })

    // Then
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'berlinDay')
  })

  test('Add new opens the add page and Back returns', async () => {
    // When
    await frame.getByRole('button', { name: 'Add new' }).click()

    // Then
    await expect(frame.getByRole('heading', { name: "Let's add a domain" })).toBeVisible()
    await expect(frame.locator('.field input')).toBeVisible()

    // When
    await frame.getByRole('button', { name: 'Back' }).click()

    // Then
    await expect(frame.getByRole('button', { name: 'Add new' })).toBeVisible()
  })
})

test('the project detail route shows the header and tabs', async ({ browser }) => {
  // Given
  const host = await startUnsignedHost()
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await navigateToTestHost(page, host.url)
  const frame = await getProductFrame(page, '.toolbar')

  // When
  await frame.evaluate(() => {
    window.history.pushState({}, '', '/d/browse')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  // Then
  await expect(frame.locator('.detail-head')).toBeVisible()
  await expect(frame.locator('.card-domain')).toHaveText('browse.dot.li')
  await expect(frame.getByRole('tab', { name: 'Overview' })).toBeVisible()
  await expect(frame.getByRole('tab', { name: 'Analytics' })).toBeVisible()

  // When
  await frame.getByRole('tab', { name: 'Settings' }).click()

  // Then
  await expect(frame.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
    'aria-selected',
    'true'
  )

  await context.close()
  await host.close()
})
