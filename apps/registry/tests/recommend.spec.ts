/**
 * Recommend E2E Tests
 *
 * Validates recommendation behaviour.
 */

import type { BrowserContext, Frame, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { bindIdentityAndAttest } from './fixtures/bind-identity-and-attest'
import {
  createUnboundProductAccount,
  IDENTITY_ACCOUNT,
  type UnboundProduct
} from './fixtures/bind-identity'
import {
  boundIdentityOf,
  createDevSigner,
  createIdentitySigner,
  fundWithNative,
  transferAllWithNative,
  transferAllWithPgas
} from './fixtures/fund'
import { fundProductAccount } from './fixtures/product-account'
import { createRevokedAttestation } from './fixtures/revoke-attestation'
import { getProductFrame, navigateToTestHost, startSignedHost } from './utils'

/**
 * Search for `label` and return its card once it shows.
 *
 * The search box has come back empty after a fill in some runs, so the label is
 * typed again only then. A box that still holds the label fails on the card
 * within the usual 15s.
 */
async function searchFor(frame: Frame, label: string): Promise<Locator> {
  const input = frame.locator('.search-bar__input')
  const card = frame.locator(`.product-card[data-label="${label}"]`)
  for (let attempt = 1; ; attempt++) {
    await input.fill(label)
    try {
      await expect(card).toBeVisible({ timeout: 15_000 })
      return card
    } catch (error) {
      if (attempt >= 3 || (await input.inputValue()) === label) throw error
    }
  }
}

/**
 * The count a card shows once a sync in flight has stopped moving it. Reading it
 * mid-sync makes the recommendation look like it counted for nothing, and a
 * refresh that started before the write lands can still clobber it once, so the
 * assertions that follow outlast a refresh too.
 */
async function settledCount(counter: Locator): Promise<number> {
  const read = async () => {
    if ((await counter.count()) === 0) return 0
    const text = (await counter.textContent()) ?? ''
    return text === '' ? 0 : text === '999+' ? 1000 : Number(text)
  }
  let last = await read()
  for (let i = 0; i < 20; i++) {
    await counter.page().waitForTimeout(500)
    const next = await read()
    if (next === last) return next
    last = next
  }
  return last
}

test.describe('Recommend works', () => {
  // A retry finds the recommends already made by the host and un-recommends
  // them, so it can only fail, and would hide the first failure.
  test.describe.configure({ retries: 0 })

  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext
  let page: Page
  let frame: Frame
  let productAccount: string

  test.beforeAll(async ({ browser }) => {
    // Funding the product account can first claim PGAS for the funder.
    test.setTimeout(240_000)
    await fundWithNative(createIdentitySigner().address)
    // following.spec.ts attests these as the identity, and the one-per-identity
    // lock would refuse the recommends below.
    await createRevokedAttestation('calculator').catch(() => {})
    await createRevokedAttestation('stopwatch').catch(() => {})
    host = await startSignedHost(IDENTITY_ACCOUNT)
    // The host derives the account that pays for a recommendation from the run
    // entropy, so it is fresh and unbound each run. Fund the one it derives.
    productAccount = await fundProductAccount(IDENTITY_ACCOUNT)
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    await page?.close()
    await context?.close()
    await host?.close()
  })

  // The product account of the run is unbound until its first write, so this
  // test goes first and makes it. It takes `stopwatch`, which no other recommend
  // in this file touches, and `calculator` stays free for the refusal spec below.
  test('As a first-time user, when I recommend an app, I reveal my primary identity and recommend in a single signature', async () => {
    // The first recommendation of a run binds the identity and attests in one
    // batch, so it is the slowest write the suite makes, and the toast waits on
    // the network confirming it.
    test.setTimeout(180_000)
    page = await context.newPage()

    // Given
    expect(
      await boundIdentityOf(productAccount),
      'the product account must be unbound for the recommend to bind it'
    ).toBe(0n)
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.search-bar__input')
    await frame.locator('.search-bar__input').fill('stopwatch')
    const card = frame.locator('.product-card[data-label="stopwatch"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')

    // When
    await upvote.click()

    // Then
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 120_000 })
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!', {
      timeout: 120_000
    })
    const identity = await boundIdentityOf(createIdentitySigner().address)
    await expect.poll(() => boundIdentityOf(productAccount), { timeout: 30_000 }).toBe(identity)
  })

  test('As a signed user, when I recommend an app, I see the count go up and a confirmation toast', async () => {
    test.setTimeout(180_000)
    page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    const card = frame.locator('.product-card[data-label="chess-clock"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')
    const upvoteCount = upvote.locator('.product-card__upvote-count')
    const before = await settledCount(upvoteCount)

    // When
    await upvote.click()

    // Then
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 120_000 })
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!', {
      timeout: 120_000
    })

    // Then
    // A sync that started before the write carries the older count and lands on
    // top of it, so read the count back from a fresh load instead.
    await page.reload({ waitUntil: 'commit' })
    frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    const reloadedCount = frame
      .locator('.product-card[data-label="chess-clock"] .product-card__upvote-count')
      .first()
    await expect(reloadedCount).toHaveText(String(before + 1), { timeout: 45_000 })
  })

  test('As a signed user, when I search for a domain and recommend it, I see the count go up and a confirmation toast', async () => {
    test.setTimeout(180_000)
    page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.search-bar__input')
    const card = await searchFor(frame, 'alarm-clock')
    const upvote = card.locator('.product-card__upvote')
    const upvoteCount = upvote.locator('.product-card__upvote-count')
    const hasCount = (await upvoteCount.count()) > 0
    const beforeText = hasCount ? ((await upvoteCount.textContent()) ?? '') : ''
    const before = beforeText === '' ? 0 : beforeText === '999+' ? 1000 : Number(beforeText)

    // When
    await upvote.click()

    // Then
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 120_000 })
    await expect(upvoteCount).toHaveText(String(before + 1), { timeout: 45_000 })
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!', {
      timeout: 120_000
    })
  })

  test('As a signed user, when I un-recommend an app, I see the count go down and a confirmation toast', async () => {
    test.setTimeout(180_000)
    page = await context.newPage()

    // Given
    // Only the host holds the key to the account that signs a recommendation,
    // so the app has to make the one it un-makes.
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    const card = frame.locator('.product-card[data-label="unit-converter"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')
    const upvoteCount = upvote.locator('.product-card__upvote-count')
    await upvote.click()
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 120_000 })
    await expect(upvoteCount).toBeVisible()
    const beforeText = (await upvoteCount.textContent()) ?? ''
    const before = beforeText === '999+' ? 1000 : Number(beforeText)
    expect(before).toBeGreaterThan(0)

    // When
    await upvote.click()

    // Then
    await expect(upvote).not.toHaveClass(/product-card__upvote--active/, { timeout: 15_000 })
    if (before > 1) {
      await expect(upvoteCount).toHaveText(String(before - 1), { timeout: 45_000 })
    } else {
      await expect(upvoteCount).not.toBeVisible({ timeout: 15_000 })
    }
    await expect(frame.locator('.toast--visible')).toContainText('Unrecommended!', {
      timeout: 60_000
    })
  })

  test('As a signed user, when I search for a domain and unrecommend it, I see the count go down and a confirmation toast', async () => {
    test.setTimeout(180_000)
    page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.search-bar__input')
    const card = await searchFor(frame, 'countdown-timer')
    const upvote = card.locator('.product-card__upvote')
    const upvoteCount = upvote.locator('.product-card__upvote-count')
    await upvote.click()
    await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 120_000 })
    await expect(upvoteCount).toBeVisible()
    const beforeText = (await upvoteCount.textContent()) ?? ''
    const before = beforeText === '999+' ? 1000 : Number(beforeText)
    expect(before).toBeGreaterThan(0)

    // When
    await upvote.click()

    // Then
    await expect(upvote).not.toHaveClass(/product-card__upvote--active/)
    if (before > 1) {
      await expect(upvoteCount).toHaveText(String(before - 1), { timeout: 45_000 })
    } else {
      await expect(upvoteCount).not.toBeVisible()
    }
    await expect(frame.locator('.toast--visible')).toContainText('Unrecommended!', {
      timeout: 60_000
    })
  })
})

test.describe('Recommendation fails', () => {
  // The account a recommendation fails through: a fresh, zero-balance keypair.
  let unfundedHost: Awaited<ReturnType<typeof startSignedHost>>
  // The product account of the run identity, a second product account of the
  // identity that already recommended `calculator` through the seeded account below.
  let identityHost: Awaited<ReturnType<typeof startSignedHost>>
  let seed: UnboundProduct
  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    // Fresh entropy per run gives a session whose product account has a
    // guaranteed zero balance.
    unfundedHost = await startSignedHost({
      name: 'Unfunded',
      entropy: crypto.getRandomValues(new Uint8Array(32))
    })

    // Seed a standing recommendation: a fresh account binds the identity and
    // recommends `calculator`, so a second account of the same identity is refused.
    await fundWithNative(createIdentitySigner().address)
    await createRevokedAttestation('calculator').catch(() => {})
    seed = await createUnboundProductAccount()
    await createRevokedAttestation('calculator', createDevSigner(seed.tag)).catch(() => {})
    await bindIdentityAndAttest(seed.tag, 'calculator')
    identityHost = await startSignedHost(IDENTITY_ACCOUNT)

    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    test.setTimeout(120_000)
    if (seed) {
      await createRevokedAttestation('calculator', createDevSigner(seed.tag)).catch(() => {})
      await transferAllWithPgas(seed.tag).catch((error) =>
        console.warn(`reclaiming PGAS from seed ${seed.tag} failed: ${String(error)}`)
      )
      await transferAllWithNative(seed.tag).catch((error) =>
        console.warn(`reclaiming native from seed ${seed.tag} failed: ${String(error)}`)
      )
    }
    await context?.close()
    await unfundedHost?.close()
    await identityHost?.close()
  })

  test('As a signed user, when I recommend an app and it fails, I see an error badge with a message', async () => {
    // A cold All list, then the failing write.
    test.setTimeout(60_000)
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

  test('As a user with a second product account, when I un-recommend an app another account of my identity recommended, it is refused and nothing is signed', async () => {
    test.setTimeout(90_000)
    const page = await context.newPage()

    // Given
    await navigateToTestHost(page, identityHost.url)
    const frame = await getProductFrame(page, '.search-bar__input')
    const search = frame.locator('.search-bar__input')
    const card = frame.locator('.product-card[data-label="calculator"]')
    const upvote = card.locator('.product-card__upvote')
    expect(
      await frame.evaluate(() => window.__queryClient !== undefined),
      'window.__queryClient is exposed only in dev builds'
    ).toBe(true)
    // "You recommended this" needs the identity, which the app waits 3s for and
    // caches when it lands later. A search answered without it is cached for a
    // minute, so drop that answer and search again until the identity shows.
    await expect(async () => {
      await frame.evaluate(() =>
        window.__queryClient?.removeQueries({ queryKey: ['resolveLabel', 'calculator'] })
      )
      await search.fill('')
      await search.fill('calculator')
      await expect(upvote).toHaveClass(/product-card__upvote--active/, { timeout: 10_000 })
    }).toPass({ timeout: 60_000 })

    // When
    await upvote.click()

    // Then
    await expect(frame.locator('.toast--visible')).toContainText('Already recommended by you', {
      timeout: 25_000
    })
    await expect(upvote).toHaveClass(/product-card__upvote--active/)
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as { __TEST_HOST__: { getSigningLog(): unknown[] } }
          ).__TEST_HOST__.getSigningLog().length
      )
    ).toBe(0)
  })
})

// Every test that recommends as the run identity lives in this file, so one
// worker runs them in order. The suite never signs as the product account, so
// it cannot revoke a recommendation, and this test takes unit-converter, which
// the un-recommend test above leaves clean.
test.describe('Recommend motion', () => {
  test.describe.configure({ retries: 0 })

  test('Recommending an app bubbles when the network confirms', async ({ browser }) => {
    test.setTimeout(180_000)
    await fundWithNative(createIdentitySigner().address)
    const host = await startSignedHost(IDENTITY_ACCOUNT)
    // The host derives the account that pays for the recommendation.
    await fundProductAccount(IDENTITY_ACCOUNT, 5_000_000_000n)
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      reducedMotion: 'no-preference'
    })
    const page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    const card = frame.locator('.product-card[data-label="unit-converter"]')
    await expect(card).toBeVisible({ timeout: 15_000 })
    const upvote = card.locator('.product-card__upvote')

    // When
    await upvote.click()

    // Then
    await Promise.all([
      expect(card.locator('.product-card__bubble').first()).toBeVisible({ timeout: 120_000 }),
      expect(frame.locator('.toast--visible')).toContainText('Recommended!', { timeout: 120_000 })
    ])

    // Linger in headed runs so the bubbling is watchable. CI never sets HEADED.
    if (process.env.HEADED === '1') await frame.waitForTimeout(4000)

    await page.close()
    await context.close()
    await host.close()
  })
})
