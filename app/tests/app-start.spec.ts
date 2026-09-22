/**
 * App Start E2E Tests
 *
 * Validates the initial state and navigation of browse for signed and unsigned users.
 */

import type { BrowserContext, Frame } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { createCachedApps } from './fixtures/cache'
import {
  BOOKMARKS_KEY,
  LABELS_KEY,
  productStorageKey,
  readProductStorage,
  resetProductStorage,
  writeProductStorage
} from './fixtures/host-storage'
import { seedIconPreimage } from './fixtures/seed-preimage'
import { getProductFrame, navigateToTestHost, startSignedHost, startUnsignedHost } from './utils'
import { filterApps, type AppEntry } from '../src/state/apps/types'

test.describe('App Start', () => {
  test.describe('unsigned user', () => {
    let host: Awaited<ReturnType<typeof startUnsignedHost>>
    let context: BrowserContext
    let frame: Frame

    test.beforeAll(async ({ browser }) => {
      // The first hook of the run pays for the cold start: the dev server, the
      // host, and the app's first sync.
      test.setTimeout(120_000)
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

    test('As an unsigned user, I see the Bookmarks, Following and All tabs', async () => {
      // Then
      const tabs = frame.locator('.category-tab')
      expect(await tabs.count()).toBe(3)
      const tabLabels = await tabs.allTextContents()
      expect(tabLabels).toEqual(['Bookmarks', 'Following', 'All'])

      // Then
      const activeTab = frame.locator('.category-tab--active')
      await expect(activeTab).toHaveText('All')
    })

    test('As an unsigned user, when I open browse, the All tab loads apps immediately', async () => {
      // The waits inside this test already sum past a minute before the second
      // page load, so the budget has to clear them.
      test.setTimeout(180_000)
      // Then
      const cards = frame.locator('.product-card[data-label]')
      await expect(cards.first()).toBeVisible({ timeout: 20_000 })
      expect(await cards.count()).toBeGreaterThan(0)
      await expect(cards.first().locator('.product-card__name')).not.toBeEmpty()
      await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })
      // The test host has no IPFS backend, so seed calculator's icon bytes for its lookup.
      await seedIconPreimage(frame.page(), 'calculator')
      const calculatorIcon = frame.locator(
        '.product-card[data-label="calculator"] .product-card__thumb-img'
      )
      await expect(calculatorIcon).toHaveClass(/product-card__thumb-img--loaded/, {
        timeout: 20_000
      })

      // When
      const reloaded = await context.newPage()
      await navigateToTestHost(reloaded, host.url)
      const reloadedFrame = await getProductFrame(reloaded, '.category-tab')

      // The first page is still open and syncing, and `lib/client.ts` rate-gates
      // RPC to about 2.5 per second, so the second instance can take noticeably
      // longer than a lone cold start.

      // Then
      await expect(reloadedFrame.locator('.product-card[data-label]').first()).toBeVisible({
        timeout: 30_000
      })
      await expect(reloadedFrame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

      await reloaded.close()
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

    test('As a signed user, I see the Bookmarks, Following and All tabs', async () => {
      // Then
      const tabs = frame.locator('.category-tab')
      expect(await tabs.count()).toBe(3)
      const tabLabels = await tabs.allTextContents()
      expect(tabLabels).toEqual(['Bookmarks', 'Following', 'All'])

      // Then
      const activeTab = frame.locator('.category-tab--active')
      await expect(activeTab).toHaveText('All')
    })

    test('As a signed user, when the All tab loads, I see products ordered by the selected sort', async () => {
      // Two sorts, each waiting on a live list, plus a poll for the reorder.
      test.setTimeout(90_000)

      // The app disables the tabs while `coldStart` holds, so clicking before a
      // card lands waits on a disabled button for the whole budget.

      // Given
      await frame.waitForSelector('.product-card[data-label]', { timeout: 30_000 })

      // When
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await expect(frame.locator('.product-card[data-label]').first()).toBeVisible()
      await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })
      const cards = frame.locator('.product-card[data-label]')
      expect(await cards.count()).toBeGreaterThan(1)

      const domOrder = () =>
        cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-label')))
      // A sync that lands a publishedAt re-sorts the list, so read both sides
      // together and let them settle rather than catching a frame in between.
      const orderedAs = async (sort: 'relevant' | 'new') => {
        const dom = await domOrder()
        const apps = await frame.evaluate(() => {
          const qc = (
            window as unknown as { __queryClient?: { getQueryData: (key: unknown[]) => unknown } }
          ).__queryClient
          return (qc?.getQueryData(['apps', 'all']) as unknown[] | undefined) ?? []
        })
        const expected = filterApps(
          apps as AppEntry[],
          '',
          'all',
          undefined,
          undefined,
          undefined,
          sort
        )
          .map((app) => app.label)
          .filter((label) => dom.includes(label))
        return { dom, expected }
      }
      // The default sort is Relevant.
      await expect
        .poll(async () => {
          const { dom, expected } = await orderedAs('relevant')
          return dom.join() === expected.join()
        })
        .toBe(true)

      // When
      await frame.locator('.customize-trigger').click()
      await frame.locator('.customize-nav-row', { hasText: 'Order by' }).click()
      await frame.locator('.order-panel__option', { hasText: 'New' }).click()

      // Then
      await expect
        .poll(async () => {
          const { dom, expected } = await orderedAs('new')
          return dom.join() === expected.join()
        })
        .toBe(true)

      // Then
      const labelCount =
        (await readProductStorage<unknown[]>(frame.page(), LABELS_KEY))?.length ?? 0
      expect(labelCount).toBeGreaterThan(1)
    })

    test('As a signed user, when cached label metadata is older than the TTL, it refreshes (fresh entries are left alone)', async () => {
      test.setTimeout(150_000)
      const page = await context.newPage()

      // Given
      await navigateToTestHost(page, host.url)
      const frameInit = await getProductFrame(page, '.category-tab')
      await frameInit.locator('.category-tab', { hasText: 'All' }).click()
      await frameInit.waitForSelector('.product-card', { timeout: 30_000 })
      const labelsAfterSync =
        (await readProductStorage<Array<{ label: string; fetchedAt?: number }>>(
          page,
          LABELS_KEY
        )) ?? []
      expect(labelsAfterSync.length).toBeGreaterThan(1)
      const staleLabel = labelsAfterSync[0].label
      const freshLabel = labelsAfterSync[1].label
      const originalFreshTs = labelsAfterSync[1].fetchedAt
      const STALE_TS = Date.now() - 25 * 3_600_000
      await writeProductStorage(
        page,
        LABELS_KEY,
        labelsAfterSync.map((l) => (l.label === staleLabel ? { ...l, fetchedAt: STALE_TS } : l))
      )

      // When
      await page.reload({ waitUntil: 'commit' })
      const frame = await getProductFrame(page, '.category-tab')
      await frame.locator('.category-tab', { hasText: 'All' }).click()

      // Then
      await page.waitForFunction(
        ({ key, target, stale }) => {
          const raw = window.__TEST_HOST__?.getProductStorage()[key]
          const arr = (raw ? JSON.parse(raw) : []) as Array<{ label: string; fetchedAt?: number }>
          const e = arr.find((l) => l.label === target)
          return e !== undefined && (e.fetchedAt ?? 0) > stale
        },
        { key: productStorageKey(LABELS_KEY), target: staleLabel, stale: STALE_TS },
        { timeout: 30_000 }
      )

      // Then
      const labelsAfterRefresh =
        (await readProductStorage<Array<{ label: string; fetchedAt?: number }>>(
          page,
          LABELS_KEY
        )) ?? []
      expect(labelsAfterRefresh.find((l) => l.label === freshLabel)?.fetchedAt).toBe(
        originalFreshTs
      )

      await page.close()
    })

    test('As a signed user, when I reload, cached apps show instantly while sync runs in the background', async () => {
      test.setTimeout(150_000)
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
      await expect(frame.locator('.product-card').nth(3)).toBeVisible({ timeout: 30_000 })
      await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

      // Then
      const labelCount = (await readProductStorage<unknown[]>(page, LABELS_KEY))?.length ?? 0
      expect(labelCount).toBeGreaterThan(3)

      await page.close()
    })

    test('As a signed user, when I leave and refocus browse, the apps are refetched', async () => {
      test.setTimeout(150_000)
      const page = await context.newPage()
      await navigateToTestHost(page, host.url)
      const frame = await getProductFrame(page, '.category-tab')

      // Given
      await frame.locator('.category-tab', { hasText: 'All' }).click()
      await expect(frame.locator('.loading-dots')).toBeVisible()
      await frame.waitForSelector('.product-card', { timeout: 30_000 })
      await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })
      const cardCountBefore = await frame.locator('.product-card').count()

      // When
      await frame.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('blur'))
      })
      await page.waitForTimeout(300)
      await frame.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('focus'))
        void window.__queryClient?.invalidateQueries({ queryKey: ['apps', 'all'] })
      })

      // Then
      await expect(frame.locator('.product-card').first()).toBeVisible()
      await expect(frame.locator('.loading-dots')).toBeVisible()
      await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })
      const cardCountAfter = await frame.locator('.product-card').count()
      expect(cardCountAfter).toBe(cardCountBefore)

      await page.close()
    })

    test('As a user, when I close and reopen the app, it finishes loading instead of spinning forever', async () => {
      test.setTimeout(180_000)
      const page = await context.newPage()

      // Emulate the native host: backgrounding tears down the chain WebSocket and
      // silently orphans in-flight requests (no response, no error), and
      // foregrounding brings a healthy socket back. We proxy the real chain WS and
      // drop frames during the close/reopen window.
      const gate = { drop: false }
      await page.routeWebSocket(/substrate\.dev|polkadot\.io/, (ws) => {
        const server = ws.connectToServer()
        ws.onMessage((message) => {
          if (!gate.drop) server.send(message)
        })
        server.onMessage((message) => {
          if (!gate.drop) ws.send(message)
        })
      })

      // Given
      await navigateToTestHost(page, host.url)
      const frame = await getProductFrame(page, '.category-tab')
      await frame.locator('.category-tab', { hasText: 'All' }).click()
      await frame.waitForSelector('.product-card', { timeout: 30_000 })
      await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 10_000 })

      // When
      gate.drop = true
      await frame.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('blur'))
      })
      await page.waitForTimeout(300)
      await frame.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('focus'))
        void window.__queryClient?.invalidateQueries({ queryKey: ['apps', 'all'] })
      })
      await page.waitForTimeout(2_000)
      gate.drop = false

      // Then
      await expect(frame.locator('.loading-dots')).not.toBeVisible({ timeout: 25_000 })

      await page.close()
    })

    test('As a user, when I bookmark a searched app, its name and icon survive a background synchronization after TTL', async () => {
      test.setTimeout(180_000)
      const page = await context.newPage()
      const target = 'alarm-clock'

      // Given
      // This one is about the cache's own lifecycle, so it starts from an empty
      // store rather than what the tests before it left in the context.
      await resetProductStorage(page)
      await navigateToTestHost(page, host.url)
      let frame = await getProductFrame(page, '.category-tab')
      await frame.waitForSelector('.product-card', { timeout: 30_000 })
      await frame.locator('.search-bar__input').fill(target)
      const card = frame.locator(`.product-card[data-label="${target}"]`)
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(card.locator('.product-card__name')).toHaveText('Alarm Clock')
      await card.locator('.product-card__bookmark').click()
      // The write crosses the host bridge, and the reload below drops whatever
      // has not landed.
      await expect
        .poll(async () => (await readProductStorage<string[]>(page, BOOKMARKS_KEY)) ?? [])
        .toContain(target)

      // When
      // The searched label is written on its own round trip, and rewriting the
      // cache before it lands would drop it.
      await expect
        .poll(async () =>
          ((await readProductStorage<Array<{ label: string }>>(page, LABELS_KEY)) ?? []).map(
            (l) => l.label
          )
        )
        .toContain(target)
      const cached =
        (await readProductStorage<Array<{ label: string; fetchedAt?: number }>>(
          page,
          LABELS_KEY
        )) ?? []
      await writeProductStorage(
        page,
        LABELS_KEY,
        cached.map((l) => ({ ...l, fetchedAt: 1 }))
      )
      await page.reload({ waitUntil: 'commit' })
      frame = await getProductFrame(page, '.category-tab')
      await page.waitForFunction(
        (key) => {
          const raw = window.__TEST_HOST__?.getProductStorage()[key]
          const arr = (raw ? JSON.parse(raw) : []) as Array<{ fetchedAt?: number }>
          return arr.length > 0 && arr.some((l) => (l.fetchedAt ?? 0) > 1000)
        },
        productStorageKey(LABELS_KEY),
        { timeout: 60_000 }
      )

      // Then
      await frame.locator('.category-tab', { hasText: 'Bookmarks' }).click()
      const bookmarked = frame.locator(`.product-card[data-label="${target}"]`)
      // The label refreshes behind the published ones, so the card can take a
      // while to come back, but come back it must, with its name.
      await expect(bookmarked).toBeVisible({ timeout: 90_000 })
      await expect(bookmarked.locator('.product-card__name')).toHaveText('Alarm Clock', {
        timeout: 30_000
      })

      await page.close()
    })

    test('As a user, when I open a searched app then return and reload, I see the All list instantly', async () => {
      test.setTimeout(150_000)
      const page = await context.newPage()
      const target = 'countdown-timer'
      const listedLabels = async (fr: Frame) =>
        (await fr
          .locator('.product-card')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-label')))) as string[]

      // Given
      await navigateToTestHost(page, host.url)
      let frame = await getProductFrame(page, '.category-tab')
      await frame.waitForSelector('.product-card', { timeout: 30_000 })
      await frame.locator('.search-bar__input').fill(target)
      const card = frame.locator(`.product-card[data-label="${target}"]`)
      await expect(card).toBeVisible({ timeout: 20_000 })

      // When
      await card.locator('.product-card__open').click()
      await page.goto('about:blank')
      await page.goBack({ waitUntil: 'commit' })
      await getProductFrame(page, '.category-tab')
      await page.reload({ waitUntil: 'commit' })
      frame = await getProductFrame(page, '.category-tab')

      // Then
      await frame.waitForSelector('.product-card', { timeout: 30_000 })
      expect(await listedLabels(frame)).not.toContain(target)

      await page.close()
    })
  })
})
