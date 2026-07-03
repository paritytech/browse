/**
 * Certificate E2E Tests
 */

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createCachedApps } from './fixtures/cache'
import { getProductFrame, navigateToTestHost, startSignedHost } from './utils'

const CERTIFICATE_NAME = 'Parity User Interface Compliance'

test.describe('Certificate', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    host = await startSignedHost('alice')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('A certified app shows a named badge that opens the certificate modal', async () => {
    const page = await context.newPage()

    // Given
    await createCachedApps(page, {
      overrides: {
        calculator: {
          certificate: {
            id: `0x${'ab'.repeat(32)}`,
            attester: '0x35Cdb23fF7fc86E8DCcd577CA309bFEA9c978D20',
            issuedAt: 1_715_212_320,
            expiresAt: 0,
            cid: null
          }
        }
      }
    })
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    await frame.waitForSelector('.product-card', { timeout: 10_000 })
    const badge = frame.locator('.product-card__certified')

    // Then
    await expect(badge).toHaveCount(1)
    await expect(badge).toHaveAttribute('aria-label', CERTIFICATE_NAME)

    // When
    await badge.click()

    // Then
    const body = frame.locator('.certificate-modal__body')
    await expect(frame.locator('.certificate-modal--visible')).toBeVisible()
    await expect(frame.locator('.certificate-modal__title')).toHaveText(CERTIFICATE_NAME)
    await expect(body).toContainText('Parity Technologies')
    await expect(frame.locator('.certificate-modal__copy').first()).toBeVisible()

    // When
    await frame.locator('.certificate-modal__close').click()

    // Then
    await expect(frame.locator('.certificate-modal--visible')).toHaveCount(0)

    await page.close()
  })
})
