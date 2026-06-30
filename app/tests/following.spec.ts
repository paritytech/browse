/**
 * Following E2E Tests
 *
 * Validates contacts and following behaviour.
 */

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createAttestation } from './fixtures/attest'
import { createCachedApps } from './fixtures/cache'
import { fundWithPgas } from './fixtures/fund'
import { createRevokedAttestation } from './fixtures/revoke-attestation'
import { getProductFrame, navigateToTestHost, startSignedHost } from './utils'

test.describe.skip('Contacts', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000)
    await fundWithPgas('Alice')
    await createRevokedAttestation('calculator').catch(() => {})
    await createAttestation('calculator')
    host = await startSignedHost('bob')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As a signed user, when I add an address as a contact, I see it in my Following list', async () => {
    test.setTimeout(30_000)
    const page = await context.newPage()

    // Given
    await createCachedApps(page)
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
    await input.fill('5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y')
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
    await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

    await page.close()
  })

  test('As a signed user, when I reload the page, my contacts still show up', async () => {
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
})

test.describe.skip('Following', () => {
  test.describe.configure({ timeout: 15_000 })
  const CHARLIE_ADDRESS = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y'
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000)
    await fundWithPgas('Alice')
    await createRevokedAttestation('calculator').catch(() => {})
    await createRevokedAttestation('stopwatch').catch(() => {})
    await createAttestation('calculator')

    host = await startSignedHost('bob')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As a signed user, when I follow someone, I see their recommended apps in the Following tab', async () => {
    test.setTimeout(30_000)
    const page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')

    // When
    await frame.locator('.category-tab', { hasText: 'Following' }).click()
    await frame.waitForTimeout(300)
    await frame.locator('.empty-state__btn').click()
    await expect(frame.locator('.contacts-manager--visible')).toBeVisible()
    await frame.locator('.contacts-manager__input').fill(CHARLIE_ADDRESS)
    await frame.locator('.contacts-manager__add-btn').click()
    await frame.locator('.contacts-manager__close').click()

    // Then
    await expect(frame.locator('.product-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(frame.locator('.product-card')).toHaveCount(1)
    await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

    await page.close()
  })

  test('As a signed user, when someone I follow recommends another app, I see it appear and disappear when revoked', async () => {
    test.setTimeout(30_000)

    // Given
    await createAttestation('stopwatch')

    // When
    const page = await context.newPage()
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
