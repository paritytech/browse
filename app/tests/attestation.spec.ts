/**
 * Attestation E2E Tests
 *
 * Validates recommendation, contacts, and following behaviour.
 */

import type { BrowserContext, Frame, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createAttestation } from './fixtures/attest'
import { createCachedApps } from './fixtures/cache'
import { fund } from './fixtures/fund'
import { createRevokedAttestation } from './fixtures/revoke-attestation'
import { getProductFrame, navigateToTestHost, startSignedHost } from './utils'

test.describe('Attestation works', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext
  let page: Page
  let frame: Frame

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(30_000)
    await fund('Charlie')
    await createRevokedAttestation('host-playground', 'Charlie').catch(() => {})
    await createRevokedAttestation('e2e-test-app-alpha', 'Charlie').catch(() => {})
    host = await startSignedHost('charlie')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await page?.close()
    await createRevokedAttestation('host-playground', 'Charlie').catch(() => {})
    await createRevokedAttestation('e2e-test-app-alpha', 'Charlie').catch(() => {})
    await context?.close()
    await host?.close()
  })

  test('As Charlie, I recommend an app, the count increases, and a toast confirms', async () => {
    test.setTimeout(15_000)
    page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    const card = frame.locator('.product-card[data-label="host-playground"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')
    const upvoteCount = upvote.locator('.product-card__upvote-count')
    const hasCount = (await upvoteCount.count()) > 0
    const beforeText = hasCount ? ((await upvoteCount.textContent()) ?? '') : ''
    const before = beforeText === '' ? 0 : beforeText === '999+' ? 1000 : Number(beforeText)

    // When
    await upvote.click()

    // Then
    await expect(upvote).toHaveClass(/product-card__upvote--active/)
    await expect(upvoteCount).toHaveText(String(before + 1))
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!', {
      timeout: 15_000
    })
  })

  test('As Charlie, I un-recommend an app, the count decreases, and a toast confirms', async () => {
    test.setTimeout(30_000)
    page = await context.newPage()

    // Given
    const attestResult = await createAttestation('host-playground', 'Charlie')
    expect(attestResult.attestationCountAfter).toBe(attestResult.attestationCountBefore + 1n)
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    const card = frame.locator('.product-card[data-label="host-playground"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')
    const upvoteCount = upvote.locator('.product-card__upvote-count')
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 15_000 })
    await expect(upvoteCount).toBeVisible()
    const beforeText = (await upvoteCount.textContent()) ?? ''
    const before = beforeText === '999+' ? 1000 : Number(beforeText)
    expect(before).toBeGreaterThan(0)

    // When
    await upvote.click()

    // Then
    await expect(upvote).not.toHaveClass(/product-card__upvote--active/)
    if (before > 1) {
      await expect(upvoteCount).toHaveText(String(before - 1))
    } else {
      await expect(upvoteCount).not.toBeVisible()
    }
    await expect(frame.locator('.toast--visible')).toContainText('Unrecommended!', {
      timeout: 15_000
    })
  })
})

test.describe('Contacts', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000)
    await fund('Charlie')
    await createRevokedAttestation('e2e-test-app-alpha', 'Charlie').catch(() => {})
    await createAttestation('e2e-test-app-alpha', 'Charlie')
    host = await startSignedHost('bob')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As Bob, I add Charlie as a contact', async () => {
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

  test('As Bob, after reload the contacts still show up', async () => {
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

test.describe('Following', () => {
  test.describe.configure({ timeout: 15_000 })
  const CHARLIE_ADDRESS = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y'
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000)
    await fund('Charlie')
    await createRevokedAttestation('e2e-test-app-alpha', 'Charlie').catch(() => {})
    await createRevokedAttestation('e2e-test-app-gamma', 'Charlie').catch(() => {})
    await createAttestation('e2e-test-app-alpha', 'Charlie')

    host = await startSignedHost('bob')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As Bob, I add Charlie as a contact and see 1 attested app in the Following tab', async () => {
    test.setTimeout(30_000)
    const page = await context.newPage()

    // Given
    await createCachedApps(page)
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

  test('As Bob, after Charlie attests another app I see 2 apps, then he revokes it', async () => {
    test.setTimeout(30_000)

    // Given
    await createAttestation('e2e-test-app-gamma', 'Charlie')

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
    await createRevokedAttestation('e2e-test-app-gamma', 'Charlie').catch(() => {})
  })
})

test.describe('Attestation fails', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    // Unique derivation per run → fresh keypair → guaranteed zero balance on chain.
    const uri = `//e2e-unfunded-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    host = await startSignedHost({ name: 'Unfunded', uri })
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('As a signed user, when I recommend an app and it fails, I see an error badge with a message', async () => {
    test.setTimeout(30_000)
    const page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.product-card')
    const firstCard = frame.locator('.product-card').first()
    const upvote = firstCard.locator('.product-card__upvote')

    // When
    await upvote.click()

    // Then
    await expect(frame.locator('.toast--visible')).toContainText('Not enough funds', {
      timeout: 15_000
    })
  })
})
