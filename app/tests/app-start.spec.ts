/**
 * App Start E2E Tests
 *
 * Validates the initial state and navigation of browse for signed and unsigned users.
 */

import type { BrowserContext, Frame } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createCachedApps } from './fixtures/cache'
import { getProductFrame, navigateToTestHost, startSignedHost, startUnsignedHost } from './utils'

test.describe('App Start', () => {
  test.describe('unsigned user', () => {
    let host: Awaited<ReturnType<typeof startUnsignedHost>>
    let context: BrowserContext
    let frame: Frame

    test.beforeAll(async ({ browser }) => {
      host = await startUnsignedHost()
      context = await browser.newContext({ ignoreHTTPSErrors: true })
      const page = await context.newPage()
      await navigateToTestHost(page, host.url)
      frame = await getProductFrame(page, '.category-tab')
    })

    test.afterAll(async () => {
      await context?.close()
      await host?.close()
    })

    test('As an unsigned user, I see the Bookmarks and All tabs', async () => {
      // Then
      const tabs = frame.locator('.category-tab')
      expect(await tabs.count()).toBe(2)
      const tabLabels = await tabs.allTextContents()
      expect(tabLabels).toEqual(['Bookmarks', 'All'])

      // Then
      const activeTab = frame.locator('.category-tab--active')
      await expect(activeTab).toHaveText('All')
    })

    test('As an unsigned user, when I open browse, the All tab loads apps immediately', async () => {
      // Then
      const cards = frame.locator('.product-card')
      await expect(cards.first()).toBeVisible({ timeout: 10_000 })
      expect(await cards.count()).toBeGreaterThan(0)
      await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

      // When
      const reloaded = await context.newPage()
      await navigateToTestHost(reloaded, host.url)
      const reloadedFrame = await getProductFrame(reloaded, '.category-tab')

      // Then
      await expect(reloadedFrame.locator('.product-card').first()).toBeVisible()
      await expect(reloadedFrame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

      await reloaded.close()
    })

    test('As an unsigned user, when I open browse, I see the page header', async () => {
      // Then
      const title = frame.locator('.title')
      await expect(title).toBeVisible()
      await expect(title).toContainText('browse')
    })

    test('As an unsigned user, when I open browse, I see the search bar', async () => {
      // Then
      await expect(frame.locator('.search-bar input')).toBeVisible()
    })

    test('As an unsigned user, when I open the Bookmarks tab with no bookmarks, I see the empty state', async () => {
      // When
      await frame.locator('.category-tab', { hasText: 'Bookmarks' }).click()

      // Then
      await expect(frame.locator('.empty-state')).toBeVisible()
      await expect(frame.locator('.product-card')).toHaveCount(0)
    })
  })

  test.describe('signed user', () => {
    let host: Awaited<ReturnType<typeof startSignedHost>>
    let context: BrowserContext
    let frame: Frame

    test.beforeAll(async ({ browser }) => {
      host = await startSignedHost('alice')
      context = await browser.newContext({ ignoreHTTPSErrors: true })
      const page = await context.newPage()
      await navigateToTestHost(page, host.url)
      frame = await getProductFrame(page, '.category-tab')
    })

    test.afterAll(async () => {
      await context?.close()
      await host?.close()
    })

    test('As a signed user, I see the Bookmarks, Following, and All tabs', async () => {
      // Then
      const tabs = frame.locator('.category-tab')
      expect(await tabs.count()).toBe(3)
      const tabLabels = await tabs.allTextContents()
      expect(tabLabels).toEqual(['Bookmarks', 'Following', 'All'])

      // Then
      const activeTab = frame.locator('.category-tab--active')
      await expect(activeTab).toHaveText('All')
    })

    test('As a signed user, when the All tab loads, I see products sorted by recommendation count', async () => {
      test.setTimeout(45_000)

      // When
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await expect(frame.locator('.product-card')).toHaveCount(0)
      await expect(frame.locator('.loading-dots')).toBeVisible()
      await frame.waitForSelector('.product-card', { timeout: 50_000 })
      await expect(frame.locator('.product-card').first()).toBeVisible()
      const cards = frame.locator('.product-card')
      const cardCount = await cards.count()
      expect(cardCount).toBeGreaterThan(1)
      const cardData: Array<{ name: string; count: number }> = []
      for (let i = 0; i < cardCount; i++) {
        const card = cards.nth(i)
        const name = (await card.locator('.product-card__name').textContent()) ?? ''
        const upvoteCount = card.locator('.product-card__upvote-count')
        const hasCount = (await upvoteCount.count()) > 0
        const text = hasCount ? ((await upvoteCount.textContent()) ?? '') : ''
        const count = text === '' ? 0 : text === '999+' ? 1000 : Number(text)
        cardData.push({ name, count })
      }
      const sorted = [...cardData].sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count
        return a.name.localeCompare(b.name)
      })
      expect(cardData).toEqual(sorted)

      // Then
      const labelCount = await frame.page().evaluate(() => {
        const labels = localStorage.getItem('test-host:browse:labels')
        return labels ? (JSON.parse(labels) as unknown[]).length : 0
      })
      expect(labelCount).toBeGreaterThan(1)
    })

    test('As a signed user, when cached label metadata is older than the TTL, it refreshes (fresh entries are left alone)', async () => {
      test.setTimeout(45_000)
      const page = await context.newPage()
      const KEY = 'test-host:browse:labels'

      // Given
      await navigateToTestHost(page, host.url)
      const frameInit = await getProductFrame(page, '.category-tab')
      await frameInit.locator('.category-tab', { hasText: 'All' }).click()
      await frameInit.waitForSelector('.product-card', { timeout: 50_000 })
      const labelsAfterSync = await page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{
            label: string
            fetchedAt?: number
          }>,
        KEY
      )
      expect(labelsAfterSync.length).toBeGreaterThan(1)
      const staleLabel = labelsAfterSync[0].label
      const freshLabel = labelsAfterSync[1].label
      const originalFreshTs = labelsAfterSync[1].fetchedAt
      const STALE_TS = Date.now() - 25 * 3_600_000
      await page.evaluate(
        ({ key, target, stale }) => {
          const arr = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{
            label: string
            fetchedAt?: number
          }>
          const e = arr.find((l) => l.label === target)
          if (e) e.fetchedAt = stale
          localStorage.setItem(key, JSON.stringify(arr))
        },
        { key: KEY, target: staleLabel, stale: STALE_TS }
      )

      // When
      await page.reload({ waitUntil: 'commit' })
      const frame = await getProductFrame(page, '.category-tab')
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await page.waitForFunction(
        ({ key, target, stale }) => {
          const arr = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{
            label: string
            fetchedAt?: number
          }>
          const e = arr.find((l) => l.label === target)
          return e !== undefined && (e.fetchedAt ?? 0) > stale
        },
        { key: KEY, target: staleLabel, stale: STALE_TS },
        { timeout: 30_000 }
      )

      // Then
      const freshTsAfter = await page.evaluate(
        ({ key, target }) => {
          const arr = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{
            label: string
            fetchedAt?: number
          }>
          return arr.find((l) => l.label === target)?.fetchedAt
        },
        { key: KEY, target: freshLabel }
      )
      expect(freshTsAfter).toBe(originalFreshTs)

      await page.close()
    })

    test('As a signed user, when I reload, cached apps show instantly while sync runs in the background', async () => {
      test.setTimeout(45_000)
      const page = await context.newPage()
      await navigateToTestHost(page, host.url)
      let frame: Frame = await getProductFrame(page, '.category-tab')

      // Given
      await createCachedApps(page)
      await page.reload({ waitUntil: 'commit' })
      frame = await getProductFrame(page, '.category-tab')

      // When
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await expect(frame.locator('.product-card').first()).toBeVisible()
      await expect(frame.locator('.loading-dots')).toBeVisible()
      await expect(frame.locator('.product-card').nth(3)).toBeVisible({ timeout: 90_000 })

      // Then
      const labelCount = await page.evaluate(() => {
        const labels = localStorage.getItem('test-host:browse:labels')
        return labels ? (JSON.parse(labels) as unknown[]).length : 0
      })
      expect(labelCount).toBeGreaterThan(3)

      await page.close()
    })
  })
})
