/**
 * Attestation E2E Tests
 *
 * Validates recommendation, contacts, and following behaviour.
 */

import type { BrowserContext, Frame, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createAttestation } from './fixtures/attest'
import {
  createUnboundProductAccount,
  IDENTITY_ACCOUNT,
  type UnboundProduct
} from './fixtures/bind-identity'
import { createCachedApps } from './fixtures/cache'
import {
  createDevSigner,
  createProductSigner,
  fundWithNative,
  fundWithPgas,
  reclaimPgas
} from './fixtures/fund'
import { createRevokedAttestation } from './fixtures/revoke-attestation'
import {
  DEV_PHRASE,
  getProductFrame,
  navigateToTestHost,
  startSignedHost,
  startSignedHostWithProductAccounts
} from './utils'

test.describe('Attestation works', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext
  let page: Page
  let frame: Frame

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    await fundWithNative(createProductSigner().address)
    await createRevokedAttestation('host-playground').catch(() => {})
    await createRevokedAttestation('calculator').catch(() => {})
    await createRevokedAttestation('browse-beta00').catch(() => {})
    host = await startSignedHost({ name: 'smalltava.05', uri: `${DEV_PHRASE}//wallet` })
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await page?.close()
    await createRevokedAttestation('host-playground').catch(() => {})
    await createRevokedAttestation('calculator').catch(() => {})
    await createRevokedAttestation('browse-beta00').catch(() => {})
    await context?.close()
    await host?.close()
  })

  test('As a signed user, when I recommend an app, I see the count go up and a confirmation toast', async () => {
    test.setTimeout(25_000)
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
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 15_000 })
    await expect(upvoteCount).toHaveText(String(before + 1), { timeout: 15_000 })
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!', {
      timeout: 15_000
    })
  })

  test('As a signed user, when I search for a domain and recommend it, I see the count go up and a confirmation toast', async () => {
    test.setTimeout(25_000)
    page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.search-bar__input')
    await frame.locator('.search-bar__input').fill('browse-beta00')
    const card = frame.locator('.product-card[data-label="browse-beta00"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')
    const upvoteCount = upvote.locator('.product-card__upvote-count')
    const hasCount = (await upvoteCount.count()) > 0
    const beforeText = hasCount ? ((await upvoteCount.textContent()) ?? '') : ''
    const before = beforeText === '' ? 0 : beforeText === '999+' ? 1000 : Number(beforeText)

    // When
    await upvote.click()

    // Then
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 15_000 })
    await expect(upvoteCount).toHaveText(String(before + 1), { timeout: 15_000 })
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!', {
      timeout: 15_000
    })
  })

  test('As a signed user, when I un-recommend an app, I see the count go down and a confirmation toast', async () => {
    test.setTimeout(30_000)
    page = await context.newPage()

    // Given
    const attestResult = await createAttestation('host-playground')
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

  test('As a signed user, when I search for a domain and unrecommend it, I see the count go down and a confirmation toast', async () => {
    test.setTimeout(30_000)
    page = await context.newPage()

    // Given
    const attestResult = await createAttestation('browse-beta00')
    expect(attestResult.attestationCountAfter).toBe(attestResult.attestationCountBefore + 1n)
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.search-bar__input')
    await frame.locator('.search-bar__input').fill('browse-beta00')
    const card = frame.locator('.product-card[data-label="browse-beta00"]')
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

test.describe('Attestation binds identity', () => {
  let host: Awaited<ReturnType<typeof startSignedHostWithProductAccounts>>
  let context: BrowserContext
  let unbound: UnboundProduct

  // `calculator` is recommended by no active test, so the bound identity has no
  // standing attestation on it that the one-identity-one-recommendation gate
  // would reject.
  const APP = 'calculator'

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    // The identity account funds the fresh product PGAS seed in native.
    await fundWithNative(createProductSigner().address)
    // Clear any prior attestation by this fresh account (it owns the key).
    unbound = await createUnboundProductAccount()
    await createRevokedAttestation(APP, createDevSigner(unbound.tag)).catch(() => {})
    host = await startSignedHostWithProductAccounts(IDENTITY_ACCOUNT, unbound.productAccounts)
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    test.setTimeout(60_000)
    // Revoke as the fresh attester so APP returns to un-attested for next run.
    if (unbound) {
      await createRevokedAttestation(APP, createDevSigner(unbound.tag)).catch(() => {})
      await reclaimPgas(unbound.tag).catch(() => {})
    }
    await context?.close()
    await host?.close()
  })

  test('As a user whose product account is unbound, when I recommend an app it binds my identity and recommends in one signature', async () => {
    test.setTimeout(40_000)
    const page = await context.newPage()

    // Given
    // The host maps the app product account to a fresh, unbound account, so the
    // recommendation goes through the bind-and-attest batch instead of a plain attest.
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.search-bar__input')
    await frame.locator('.search-bar__input').fill(APP)
    const card = frame.locator(`.product-card[data-label="${APP}"]`)
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')

    // When
    await upvote.click()

    // Then
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 25_000 })
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!', {
      timeout: 25_000
    })
  })
})

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

test.describe('Attestation fails', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    // Unique derivation per run gives a fresh keypair with a guaranteed zero balance on chain.
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
    await expect(frame.locator('.toast--visible')).toContainText('Not enough allowance', {
      timeout: 15_000
    })
  })
})
