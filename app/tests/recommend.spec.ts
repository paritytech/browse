/**
 * Recommend E2E Tests
 *
 * Validates recommendation behaviour.
 */

import type { BrowserContext, Frame, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createAttestation } from './fixtures/attest'
import { bindIdentityAndAttest } from './fixtures/bind-identity-and-attest'
import {
  createUnboundProductAccount,
  IDENTITY_ACCOUNT,
  type UnboundProduct
} from './fixtures/bind-identity'
import {
  createDevSigner,
  createProductSigner,
  fundWithNative,
  transferAllWithNative,
  transferAllWithPgas
} from './fixtures/fund'
import { createRevokedAttestation } from './fixtures/revoke-attestation'
import {
  DEV_PHRASE,
  getProductFrame,
  navigateToTestHost,
  startSignedHost,
  startSignedHostWithProductAccounts
} from './utils'

test.describe('Recommend works', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  // A second host signed in as the same identity but with a fresh, never-bound
  // product account at index 0, so a recommendation drives the bind-and-attest
  // batch instead of a plain attest.
  let unboundHost: Awaited<ReturnType<typeof startSignedHostWithProductAccounts>>
  let unbound: UnboundProduct
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
    unbound = await createUnboundProductAccount()
    await createRevokedAttestation('calculator', createDevSigner(unbound.tag)).catch(() => {})
    unboundHost = await startSignedHostWithProductAccounts(IDENTITY_ACCOUNT, unbound.productAccounts)
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    await page?.close()
    await createRevokedAttestation('host-playground').catch(() => {})
    await createRevokedAttestation('browse-beta00').catch(() => {})
    // `calculator` is recommended by the fresh account, so revoke it as that attester.
    if (unbound) {
      await createRevokedAttestation('calculator', createDevSigner(unbound.tag)).catch(() => {})
      await transferAllWithPgas(unbound.tag).catch(() => {})
      await transferAllWithNative(unbound.tag).catch(() => {})
    }
    await context?.close()
    await host?.close()
    await unboundHost?.close()
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

  test('As a first-time user, when I recommend an app, I reveal my primary identity and recommend in a single signature', async () => {
    test.setTimeout(40_000)
    const unboundPage = await context.newPage()

    // Given
    // The unbound host maps the product account to a fresh, never-bound account,
    // so the recommendation runs the bind-and-attest batch, not a plain attest.
    await navigateToTestHost(unboundPage, unboundHost.url)
    const unboundFrame = await getProductFrame(unboundPage, '.search-bar__input')
    await unboundFrame.locator('.search-bar__input').fill('calculator')
    const card = unboundFrame.locator('.product-card[data-label="calculator"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')

    // When
    await upvote.click()

    // Then
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 25_000 })
    await expect(unboundFrame.locator('.toast--visible')).toContainText('Recommended!', {
      timeout: 25_000
    })
  })
})

test.describe('Recommendation fails', () => {
  // The account a recommendation fails through: a fresh, zero-balance keypair.
  let unfundedHost: Awaited<ReturnType<typeof startSignedHost>>
  // The identity `//wallet` account, a second product account of the identity
  // that already recommended `calculator` through the seeded account below.
  let walletHost: Awaited<ReturnType<typeof startSignedHost>>
  let seed: UnboundProduct
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    // Unique derivation per run gives a fresh keypair with a guaranteed zero balance on chain.
    const uri = `//e2e-unfunded-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    unfundedHost = await startSignedHost({ name: 'Unfunded', uri })

    // Seed a standing recommendation: a fresh account binds the identity and
    // recommends `calculator`, so a second account of the same identity is refused.
    await fundWithNative(createProductSigner().address)
    await createRevokedAttestation('calculator').catch(() => {})
    seed = await createUnboundProductAccount()
    await createRevokedAttestation('calculator', createDevSigner(seed.tag)).catch(() => {})
    await bindIdentityAndAttest(seed.tag, 'calculator')
    walletHost = await startSignedHost({ name: 'smalltava.05', uri: `${DEV_PHRASE}//wallet` })

    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (seed) {
      await createRevokedAttestation('calculator', createDevSigner(seed.tag)).catch(() => {})
      await transferAllWithPgas(seed.tag).catch(() => {})
      await transferAllWithNative(seed.tag).catch(() => {})
    }
    await context?.close()
    await unfundedHost?.close()
    await walletHost?.close()
  })

  test('As a signed user, when I recommend an app and it fails, I see an error badge with a message', async () => {
    test.setTimeout(30_000)
    const page = await context.newPage()

    // Given
    await navigateToTestHost(page, unfundedHost.url)
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

  test('As a user with a second product account, when I recommend an app my identity already recommended, it is refused and I see an error', async () => {
    test.setTimeout(40_000)
    const page = await context.newPage()

    // Given
    await navigateToTestHost(page, walletHost.url)
    const frame = await getProductFrame(page, '.search-bar__input')
    await frame.locator('.search-bar__input').fill('calculator')
    const card = frame.locator('.product-card[data-label="calculator"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 15_000 })

    // When
    await upvote.click()

    // Then
    await expect(frame.locator('.toast--visible')).toContainText('Already recommended by you', {
      timeout: 25_000
    })
    await expect(upvote).toHaveClass(/product-card__upvote--active/)
  })
})
