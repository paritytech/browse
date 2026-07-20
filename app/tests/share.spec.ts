/**
 * Share end-to-end tests.
 *
 * The share action hands a single browse `?app=` pass-through link to the native
 * share sheet, copying to the clipboard where Web Share is unavailable. On a
 * later visit browse surfaces a deferred prompt asking whether the user liked an
 * app they were sent to from such a link. Confirming the prompt reuses the
 * attest path already covered by recommend.spec.
 */

import type { BrowserContext, Frame, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { getProductFrame, navigateToTestHost, startSignedHost } from './utils'

/** Capture native-share payloads on `window.__shared` instead of opening the OS sheet. */
async function stubShare(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const w = window as unknown as { __shared: { url?: string }[] }
    w.__shared = []
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: { url?: string }) => {
        w.__shared.push(data)
        return Promise.resolve()
      }
    })
  })
}

async function lastSharedUrl(frame: Frame): Promise<string> {
  const shared = await frame.evaluate(
    () => (window as unknown as { __shared: { url?: string }[] }).__shared
  )
  return shared[shared.length - 1]?.url ?? ''
}

test.describe('Share', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext
  let page: Page

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000)
    host = await startSignedHost()
    context = await browser.newContext({ ignoreHTTPSErrors: true })
  })

  test.afterAll(async () => {
    await page?.close()
    await context?.close()
    await host?.close()
  })

  test('As a user, when I share an app it hands the link to the native share sheet', async () => {
    test.setTimeout(45_000)
    page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    // A real card, not a cold-start skeleton. Skeletons share the `.product-card`
    // class but carry no `data-label`.
    const frame = await getProductFrame(page, '.product-card[data-label]')
    await stubShare(frame)
    const card = frame.locator('.product-card[data-label]').first()
    const label = await card.getAttribute('data-label')
    expect(label).toBeTruthy()

    // When
    await card.locator('.product-card__share').click()

    // Then
    // Running on localhost, the link routes through the network dev host back to
    // this instance rather than to production browse.
    expect(await lastSharedUrl(frame)).toMatch(
      new RegExp(`^https://testnet\\.li/localhost:\\d+\\?app=${label}$`)
    )
  })

  test('As a returning user, I am asked if I liked a shared app and dismissing clears it', async () => {
    test.setTimeout(45_000)
    page = await context.newPage()

    // Given
    // Seed a pending record as if a `?app=host-playground&from=alice` link had
    // redirected us into the app on a previous visit.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'browse.pendingRecommend',
        JSON.stringify({
          'host-playground': { label: 'host-playground', from: 'alice', seenAt: Date.now() }
        })
      )
    })
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.recommend-prompt--visible')

    // Then
    await expect(frame.locator('.recommend-prompt__text')).toContainText('Would you recommend')
    await expect(frame.locator('.recommend-prompt__btn', { hasText: 'Yes' })).toBeVisible()

    // When
    await frame.locator('.recommend-prompt__btn', { hasText: 'Not now' }).click()

    // Then
    await expect(frame.locator('.recommend-prompt--visible')).toHaveCount(0)
    const stored = await frame.evaluate(() =>
      window.localStorage.getItem('browse.pendingRecommend')
    )
    expect(stored ?? '').not.toContain('host-playground')
  })
})
