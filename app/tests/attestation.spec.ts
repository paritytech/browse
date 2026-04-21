/**
 * Attestation E2E Tests
 *
 * Validates recommendation, contacts, and following behaviour.
 */

import type { BrowserContext, Frame, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createAttestation } from './fixtures/attest'
import { createRevokedAttestation } from './fixtures/revoke-attestation'
import { getProductFrame, navigateToTestHost, seedAppsInAllTab, startSignedHost } from './utils'

test.describe('Attestation', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext
  let page: Page
  let frame: Frame

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(30_000)
    await createRevokedAttestation('e2e-test-app-alpha', 'Alice').catch(() => {})
    host = await startSignedHost('alice')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await page?.close()
    await createRevokedAttestation('e2e-test-app-alpha', 'Alice').catch(() => {})
    await context?.close()
    await host?.close()
  })

  test('As Alice, I recommend an app, the count increases, and a toast confirms', async () => {
    test.setTimeout(15_000)
    page = await context.newPage()

    // Given
    await seedAppsInAllTab(page)
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    await frame.waitForSelector('.product-card', { timeout: 10_000 })
    const alphaCard = frame.locator('.product-card[data-label="e2e-test-app-alpha"]')
    const socialProof = alphaCard.locator('.product-card__social-proof')

    // Then
    await expect(socialProof.locator('.product-card__count')).not.toBeVisible()

    // When
    await socialProof.click()

    // Then
    await expect(socialProof).toHaveClass(/product-card__social-proof--active/)
    await expect(socialProof.locator('.product-card__count')).toHaveText('1')
    await expect(socialProof.locator('svg')).toHaveAttribute('fill', 'currentColor')
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!', {
      timeout: 15_000
    })
  })

  test('As Alice, I un-recommend an app, the count decreases, and a toast confirms', async () => {
    test.setTimeout(30_000)
    page = await context.newPage()

    // Given
    await createAttestation('e2e-test-app-alpha', 'Alice')
    await seedAppsInAllTab(page)
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    await frame.waitForSelector('.product-card', { timeout: 10_000 })
    const alphaCard = frame.locator('.product-card[data-label="e2e-test-app-alpha"]')
    const socialProof = alphaCard.locator('.product-card__social-proof')
    await expect(socialProof).toHaveClass(/product-card__social-proof--active/, { timeout: 10_000 })
    await expect(socialProof.locator('.product-card__count')).toHaveText('1')
    await expect(socialProof.locator('svg')).toHaveAttribute('fill', 'currentColor')

    // When
    await socialProof.click()

    // Then
    await expect(socialProof).not.toHaveClass(/product-card__social-proof--active/)
    await expect(socialProof.locator('.product-card__count')).not.toBeVisible()
    await expect(socialProof.locator('svg')).toHaveAttribute('fill', 'none')
    await expect(frame.locator('.toast--visible')).toContainText('Unrecommended!', {
      timeout: 15_000
    })
  })
})

test.describe('Contacts', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(30_000)
    await createRevokedAttestation('e2e-test-app-alpha', 'Alice').catch(() => {})
    await createAttestation('e2e-test-app-alpha', 'Alice')
    host = await startSignedHost('bob')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As Bob, I add Alice as a contact', async () => {
    test.setTimeout(30_000)
    const page = await context.newPage()

    // Given
    await seedAppsInAllTab(page)
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
    await seedAppsInAllTab(page)
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
    await createRevokedAttestation('e2e-test-app-alpha', 'Alice').catch(() => {})
    await createRevokedAttestation('e2e-test-app-gamma', 'Alice').catch(() => {})
    await createAttestation('e2e-test-app-alpha', 'Alice')

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
    await seedAppsInAllTab(page)
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
    await createAttestation('e2e-test-app-gamma', 'Alice')

    // When
    const page = await context.newPage()
    await seedAppsInAllTab(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    await frame.locator('.category-tab', { hasText: 'Following' }).click()

    // Then
    await expect(frame.locator('.product-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(frame.locator('.product-card')).toHaveCount(2)

    await page.close()

    // Cleanup
    await createRevokedAttestation('e2e-test-app-gamma', 'Alice').catch(() => {})
  })
})
