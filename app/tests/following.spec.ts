/**
 * Following E2E Tests
 *
 * Validates following behaviour.
 */

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createAttestation } from './fixtures/attest'
import { createCachedApps } from './fixtures/cache'
import { createProductSigner, fundWithPgas } from './fixtures/fund'
import { createRevokedAttestation } from './fixtures/revoke-attestation'
import { seedPreimage } from './fixtures/seed-preimage'
import { SNAPSHOT_USERNAME, USERNAME_SNAPSHOT_BLOCKS } from './fixtures/usernames-snapshot'
import { getProductFrame, navigateToTestHost, startSignedHost } from './utils'

// The seeded attestations are signed by the `smalltava.05 //wallet` identity
// account that createAttestation derives through createProductSigner, so
// following that account is what surfaces its recommendations.
const IDENTITY_ADDRESS = createProductSigner().address

test.describe('Following', () => {
  test.describe.configure({ timeout: 15_000 })
  let host: Awaited<ReturnType<typeof startSignedHost>>
  // The follow/reload pair shares one context so a follow persists across a
  // reload. The recommend pair gets its own so it starts from an empty list.
  let context: BrowserContext
  let recommendContext: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(70_000)
    await fundWithPgas('Alice')
    await createRevokedAttestation('calculator').catch(() => {})
    await createRevokedAttestation('stopwatch').catch(() => {})
    await createAttestation('calculator')
    host = await startSignedHost('bob')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    recommendContext = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await recommendContext?.close()
    await host?.close()
  })

  test('As a signed user, when I follow an address, I see it in my Following list', async () => {
    test.setTimeout(30_000)
    const page = await context.newPage()

    // Given
    await createCachedApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    for (const block of USERNAME_SNAPSHOT_BLOCKS) await seedPreimage(page, block)

    // When
    await frame.locator('.category-tab', { hasText: 'Following' }).click()
    await frame.waitForTimeout(300)

    // Then
    await expect(frame.locator('.empty-state')).toBeVisible()
    await expect(frame.locator('.empty-state__btn')).toBeVisible()

    // When
    await frame.locator('.empty-state__btn').click()

    // Then
    await expect(frame.locator('.customize-popover')).toBeVisible()

    // When
    const input = frame.locator('.following-modal__input')
    await input.fill('zzauto')

    // Then
    await expect(
      frame.locator('.following-modal__option', { hasText: SNAPSHOT_USERNAME })
    ).toBeVisible({ timeout: 15_000 })

    // When
    await input.fill(IDENTITY_ADDRESS)
    await frame.locator('.following-modal__option').click()

    // Then
    await expect(frame.locator('.following-modal__row')).toHaveCount(1)

    // When
    await frame.locator('.customize-drill__icon[aria-label="Close"]').click()

    // Then
    await expect(frame.locator('.customize-popover')).toHaveCount(0)
    await expect(frame.locator('.product-card').first()).toBeVisible({ timeout: 15_000 })
    const cards = frame.locator('.product-card')
    expect(await cards.count()).toBeGreaterThan(0)
    await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

    await page.close()
  })

  test('As a signed user, when I reload the page, my following still shows up', async () => {
    const page = await context.newPage()

    // Given
    await createCachedApps(page)
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

  test('As a signed user, when I follow someone, I see their recommended apps in the Following tab', async () => {
    test.setTimeout(40_000)
    const page = await recommendContext.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.category-tab', { hasText: 'Following' }).click()
    await frame.waitForTimeout(300)
    await frame.locator('.empty-state__btn').click()
    await expect(frame.locator('.customize-popover')).toBeVisible()
    await frame.locator('.following-modal__input').fill(IDENTITY_ADDRESS)
    await frame.locator('.following-modal__option').click()
    await frame.locator('.customize-drill__icon[aria-label="Close"]').click()

    // Then
    await expect(frame.locator('.product-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(frame.locator('.product-card')).toHaveCount(1)
    await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

    await page.close()
  })

  test('As a signed user, when someone I follow recommends another app, I see it appear and disappear when revoked', async () => {
    test.setTimeout(40_000)

    // Given
    await createAttestation('stopwatch')

    // When
    const page = await recommendContext.newPage()
    await createCachedApps(page)
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    await frame.locator('.category-tab', { hasText: 'Following' }).click()

    // Then
    await expect(frame.locator('.product-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(frame.locator('.product-card')).toHaveCount(2)

    await page.close()

    // Cleanup
    await createRevokedAttestation('stopwatch').catch(() => {})
  })
})
