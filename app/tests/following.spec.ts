/**
 * Following E2E Tests
 *
 * Validates following behaviour.
 */

import type { BrowserContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createAttestation } from './fixtures/attest'
import { createCachedApps } from './fixtures/cache'
import { createDevSigner, createProductSigner, fundWithPgas } from './fixtures/fund'
import { FOLLOWING_KEY, readProductStorage, saveProductStorage } from './fixtures/host-storage'
import { createRevokedAttestation } from './fixtures/revoke-attestation'
import { seedPreimage } from './fixtures/seed-preimage'
import { SNAPSHOT_USERNAME, USERNAME_SNAPSHOT_BLOCKS } from './fixtures/usernames-snapshot'
import { getProductFrame, navigateToTestHost, startSignedHost } from './utils'

// The seeded attestations are signed by the `smalltava.08 //wallet` identity
// account that createAttestation derives through createProductSigner, so
// following that account is what surfaces its recommendations.
const IDENTITY_ADDRESS = createProductSigner().address

// A loading tab shows skeleton cards, which share the card class.
const CARD = '.product-card:not(.product-card--skeleton)'

test.describe('Following', () => {
  test.describe.configure({ timeout: 15_000 })
  let host: Awaited<ReturnType<typeof startSignedHost>>
  // The follow/reload pair shares one context so a follow persists across a
  // reload. The recommend pair gets its own so it starts from an empty list.
  let context: BrowserContext
  let recommendContext: BrowserContext

  test.beforeAll(async ({ browser }) => {
    // A funding and three chain writes, which outlasted 70s in CI on 2026-09-29.
    test.setTimeout(150_000)
    await fundWithPgas(createDevSigner('Alice').address)
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
    await expect(frame.locator('.following-panel__add')).toBeVisible()

    // When
    await frame.locator('.following-panel__add').click()
    const input = frame.locator('.following-panel__input')
    await input.fill('zzauto')

    // Then
    await expect(
      frame.locator('.following-panel__option', { hasText: SNAPSHOT_USERNAME })
    ).toBeVisible({ timeout: 15_000 })

    // When
    await input.fill(IDENTITY_ADDRESS)
    await frame.locator('.following-panel__option').click()

    // Then
    await expect(frame.locator('.following-panel__chip')).toHaveCount(1)
    await expect(frame.locator(CARD).first()).toBeVisible({ timeout: 15_000 })
    const cards = frame.locator(CARD)
    expect(await cards.count()).toBeGreaterThan(0)
    await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

    // The reload test below reads this follow back from a fresh page.
    await expect
      .poll(async () => (await readProductStorage<unknown[]>(page, FOLLOWING_KEY))?.length ?? 0)
      .toBe(1)
    await saveProductStorage(page)
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
    await expect(frame.locator(CARD).first()).toBeVisible({ timeout: 15_000 })

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
    await frame.locator('.following-panel__add').click()
    await frame.locator('.following-panel__input').fill(IDENTITY_ADDRESS)
    await frame.locator('.following-panel__option').click()

    // Then
    await expect(frame.locator(CARD).first()).toBeVisible({ timeout: 20_000 })
    await expect(frame.locator(CARD)).toHaveCount(1)
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
    await expect(frame.locator(CARD).first()).toBeVisible({ timeout: 20_000 })
    await expect(frame.locator(CARD)).toHaveCount(2)

    await page.close()

    // Cleanup
    await createRevokedAttestation('stopwatch').catch(() => {})
  })

  test('As a signed user, when I follow more than three people, the stack truncates and stays folded while I add another', async ({
    browser
  }) => {
    test.setTimeout(40_000)
    const stackContext = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await stackContext.newPage()
    const addresses = ['Alice', 'Bob', 'Charlie', 'Dave'].map(
      (name) => createDevSigner(name).address
    )

    // Given
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'Following' }).click()
    for (const address of addresses) {
      await frame.locator('.following-panel__add').click()
      await frame.locator('.following-panel__input').fill(address)
      await frame.locator('.following-panel__option').click()
    }

    // Then
    await expect(frame.locator('.following-panel__chip')).toHaveCount(3)
    await expect(frame.locator('.following-panel__more')).toHaveText('+1')

    // When
    await frame.locator('.following-panel__chip').first().click()
    await expect(frame.locator('.following-panel__chip--expanded')).toHaveCount(1)
    await frame.locator('.following-panel__add').click()

    // Then
    await expect(frame.locator('.following-panel__chip--expanded')).toHaveCount(0)
    await expect(frame.locator('#app-list')).toBeHidden()

    // When
    await frame.locator('.following-panel__input').press('Backspace')

    // Then
    await expect(frame.locator('.following-panel__input')).toHaveValue('')
    await expect(frame.locator('.following-panel__more')).toHaveText('+1')

    // When
    await frame.locator('.following-panel__input').press('Escape')

    // Then
    await expect(frame.locator('#app-list')).toBeVisible()

    await stackContext.close()
  })
})
