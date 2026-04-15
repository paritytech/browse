/**
 * Attestation E2E Tests
 *
 * Validates recommendation, contacts, and following behaviour.
 */

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { attestFromDev, revokeFromDev } from './fixtures/attest'
import { getProductFrame, navigateToTestHost, seedAllApps, startSignedHost } from './utils'

test.describe('Attestation', () => {
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

  test('As Alice, I recommend an app and see the confirmation toast', async () => {
    test.setTimeout(15_000)
    const page = await context.newPage()

    // Given
    await seedAllApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    await frame.waitForSelector('.product-card', { timeout: 10_000 })
    await frame.waitForTimeout(500)
    const firstCard = frame.locator('.product-card').first()
    const socialProof = firstCard.locator('.product-card__social-proof')

    // When
    await socialProof.click()

    // Then
    await expect(socialProof).toHaveClass(/product-card__social-proof--active/)
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!')

    await page.close()
  })
})

test.describe('Contacts', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    host = await startSignedHost('bob')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As Bob, I add Alice as a contact', async () => {
    const page = await context.newPage()

    // Given
    await seedAllApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.category-tab', { hasText: 'Following' }).click()
    await frame.waitForTimeout(300)

    // Then
    await expect(frame.locator('.empty-state')).toBeVisible()
    await expect(frame.locator('.empty-state__btn')).toBeVisible()

    // When
    await frame.locator('.empty-state__btn').click()

    // Then
    await expect(frame.locator('.contacts-manager--visible')).toBeVisible()

    // When
    const input = frame.locator('.contacts-manager__input')
    await input.fill('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY')
    await frame.locator('.contacts-manager__add-btn').click()

    // Then
    await expect(frame.locator('.contacts-manager__item')).toHaveCount(1)
    await expect(frame.locator('.contacts-manager__addr')).toBeVisible()

    // When
    await frame.locator('.contacts-manager__close').click()

    // Then
    await expect(frame.locator('.contacts-manager--visible')).not.toBeVisible()
    await expect(frame.locator('.product-card').first()).toBeVisible({ timeout: 15_000 })
    const cards = frame.locator('.product-card')
    expect(await cards.count()).toBeGreaterThan(0)

    await page.close()
  })

  test('As Bob, after reload the contacts still show up', async () => {
    const page = await context.newPage()

    // Given
    await seedAllApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.category-tab', { hasText: 'Following' }).click()
    await frame.waitForTimeout(300)

    // Then
    await expect(frame.locator('.empty-state')).not.toBeVisible()
    await expect(frame.locator('.product-card').first()).toBeVisible({ timeout: 15_000 })

    await page.close()
  })
})

test.describe('Following', () => {
  test.describe.configure({ timeout: 15_000 })
  const ALICE_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(30_000)
    await revokeFromDev('e2e-test-app-alpha', 'Alice').catch(() => {})
    await revokeFromDev('e2e-test-app-gamma', 'Alice').catch(() => {})
    await attestFromDev('e2e-test-app-alpha', 'Alice')

    host = await startSignedHost('bob')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As Bob, I add Alice as a contact and see 1 attested app in the Following tab', async () => {
    test.setTimeout(30_000)
    const page = await context.newPage()

    // Given
    await seedAllApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.category-tab', { hasText: 'Following' }).click()
    await frame.waitForTimeout(300)
    await frame.locator('.empty-state__btn').click()
    await expect(frame.locator('.contacts-manager--visible')).toBeVisible()
    await frame.locator('.contacts-manager__input').fill(ALICE_ADDRESS)
    await frame.locator('.contacts-manager__add-btn').click()
    await frame.locator('.contacts-manager__close').click()

    // Then
    await expect(frame.locator('.product-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(frame.locator('.product-card')).toHaveCount(1)

    await page.close()
  })

  test('As Bob, after Alice attests another app I see 2 apps, then she revokes it', async () => {
    test.setTimeout(30_000)

    // Given
    await attestFromDev('e2e-test-app-gamma', 'Alice')

    // When
    const page = await context.newPage()
    await seedAllApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    await frame.locator('.category-tab', { hasText: 'Following' }).click()

    // Then
    await expect(frame.locator('.product-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(frame.locator('.product-card')).toHaveCount(2)

    await page.close()

    // Cleanup
    await revokeFromDev('e2e-test-app-gamma', 'Alice').catch(() => {})
  })
})
