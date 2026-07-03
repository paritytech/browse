import { type Browser, type Frame, expect, test } from '@playwright/test'

import { createCachedApps } from './fixtures/cache'
import { createProductSigner, fundWithNative } from './fixtures/fund'
import { createRevokedAttestation } from './fixtures/revoke-attestation'
import { DEV_PHRASE, getProductFrame, navigateToTestHost, startSignedHost } from './utils'
import { SHUFFLE_MAX_MS, SHUFFLE_MIN_MS } from '../src/lib/use-flip'
import type { AppEntry } from '../src/state/apps/types'

type TestQueryClient = {
  cancelQueries: (filters: { queryKey: unknown[] }) => Promise<void>
  setQueryData: (key: unknown[], data: unknown) => void
  getQueryState: (key: unknown[]) => { fetchStatus: string } | undefined
}

function entry(label: string, name: string, attestationCount: number): AppEntry {
  return {
    label,
    name,
    description: `${name} description`,
    iconCid: null,
    contentHash: `ipfs://Qm${label}`,
    isLive: true,
    attestationCount,
    hasUserAttested: false,
    certificate: null
  }
}

function domOrder(frame: Frame): Promise<(string | null)[]> {
  return frame
    .locator('.product-card')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-label')))
}

// Replace the All-tab data through the same query the background sync writes to,
// after stopping any in-flight fetch so it can't clobber the value.
async function syncApps(frame: Frame, apps: AppEntry[]): Promise<void> {
  await frame.evaluate(async (apps) => {
    const qc = (window as unknown as { __queryClient?: TestQueryClient }).__queryClient
    if (!qc) throw new Error('window.__queryClient is not exposed (dev build only)')
    await qc.cancelQueries({ queryKey: ['apps', 'all'] })
    qc.setQueryData(['apps', 'all'], apps)
  }, apps)
}

// Drive one reshuffle and report the order before/after and the duration of the
// longest glide that carried a card from the old order to the new one.
async function reshuffle(
  frame: Frame,
  apps: AppEntry[]
): Promise<{ before: (string | null)[]; after: (string | null)[]; durationMs: number }> {
  const before = await domOrder(frame)
  await syncApps(frame, apps)
  const flipDetail = await frame.evaluate(async () => {
    const cards = () => Array.from(document.querySelectorAll('.product-card[data-label]'))
    const flipsOf = (card: Element) => card.getAnimations().filter((a) => a.id === 'flip-reorder')
    const start = performance.now()
    while (cards().every((c) => flipsOf(c).length === 0) && performance.now() - start < 3000) {
      await new Promise((r) => requestAnimationFrame(r))
    }
    return cards()
      .map((c) => ({
        label: c.getAttribute('data-label'),
        dur: Math.max(
          0,
          ...flipsOf(c).map((a) => Number(a.effect?.getComputedTiming().duration ?? 0))
        )
      }))
      .filter((x) => x.dur > 0)
  })
  const durationMs = flipDetail.reduce((m, f) => Math.max(m, f.dur), 0)
  // Wait for the layout to go fully static (no flip OR entry animation still
  // running), so the next reshuffle measures distances from a settled layout, not
  // a mid-glide one. Finished `fill` animations stay listed, so check playState.
  await frame.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.product-card[data-label]')).every((card) =>
        card.getAnimations().every((a) => a.playState !== 'running')
      ),
    { timeout: 6000 }
  )
  const after = await domOrder(frame)
  return { before, after, durationMs }
}

async function openApp(browser: Browser) {
  const host = await startSignedHost('alice')
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await createCachedApps(page, {
    overrides: {
      calculator: { attestationCount: 3 },
      'e2e-test-app-beta': { attestationCount: 2 },
      stopwatch: { attestationCount: 1 }
    }
  })
  await navigateToTestHost(page, host.url)
  const frame = await getProductFrame(page, '.product-card')
  await frame.locator('.category-tab', { hasText: 'All' }).click()
  // Settle the real background sync so it can't overwrite the data we drive.
  await frame.waitForFunction(
    () => {
      const qc = (window as unknown as { __queryClient?: TestQueryClient }).__queryClient
      return !!qc && qc.getQueryState(['apps', 'all'])?.fetchStatus === 'idle'
    },
    { timeout: 30000 }
  )
  const close = async () => {
    await page.close()
    await context.close()
    await host.close()
  }
  return { frame, close }
}

test.describe('Motion', () => {
  test('As a returning user, when a background sync reorders my apps, the cards glide to their new positions', async ({
    browser
  }) => {
    test.setTimeout(60000)
    const { frame, close } = await openApp(browser)

    // Given
    await reshuffle(frame, [entry('alpha', 'Alpha', 3), entry('beta', 'Beta', 2)])

    // When
    const { before, after, durationMs } = await reshuffle(frame, [
      entry('gamma', 'Gamma', 9),
      entry('alpha', 'Alpha', 3),
      entry('beta', 'Beta', 2)
    ])

    // Then
    expect(after).not.toEqual(before)
    expect(after).toEqual(['gamma', 'alpha', 'beta'])
    expect(durationMs).toBeGreaterThanOrEqual(SHUFFLE_MIN_MS)
    expect(durationMs).toBeLessThanOrEqual(SHUFFLE_MAX_MS)

    await close()
  })

  test('An identical reshuffle always takes the same time, and a longer move takes proportionally longer', async ({
    browser
  }) => {
    test.setTimeout(60000)
    const { frame, close } = await openApp(browser)

    // The same one-row swap (eee/fff), measured twice from the same base, then a
    // top-to-bottom move of aaa. Toggling zzz's membership forces each re-sort to
    // commit.
    const base = [
      entry('aaa', 'Aaa', 12),
      entry('bbb', 'Bbb', 10),
      entry('ccc', 'Ccc', 8),
      entry('ddd', 'Ddd', 6),
      entry('eee', 'Eee', 4),
      entry('fff', 'Fff', 2)
    ]
    const swapped = [
      entry('aaa', 'Aaa', 12),
      entry('bbb', 'Bbb', 10),
      entry('ccc', 'Ccc', 8),
      entry('ddd', 'Ddd', 6),
      entry('eee', 'Eee', 2),
      entry('fff', 'Fff', 4),
      entry('zzz', 'Zzz', 1)
    ]
    const aaaLast = [
      entry('bbb', 'Bbb', 10),
      entry('ccc', 'Ccc', 8),
      entry('ddd', 'Ddd', 6),
      entry('eee', 'Eee', 4),
      entry('fff', 'Fff', 2),
      entry('aaa', 'Aaa', 1),
      entry('zzz', 'Zzz', 0)
    ]

    // Given
    await reshuffle(frame, base)
    // The first reshuffle after cards mount measures from entry-animated
    // positions, so run one swap cycle to settle before measuring.
    await reshuffle(frame, swapped)
    await reshuffle(frame, base)

    // When
    const swap1 = await reshuffle(frame, swapped)
    await reshuffle(frame, base)
    const swap2 = await reshuffle(frame, swapped)
    await reshuffle(frame, base)
    const farMove = await reshuffle(frame, aaaLast)

    // Then
    for (const shuffle of [swap1, swap2, farMove]) {
      expect(shuffle.after).not.toEqual(shuffle.before)
      expect(shuffle.durationMs).toBeGreaterThanOrEqual(SHUFFLE_MIN_MS)
      expect(shuffle.durationMs).toBeLessThanOrEqual(SHUFFLE_MAX_MS)
    }
    // The same move takes the same time every time.
    expect(swap2.durationMs).toBe(swap1.durationMs)
    // A move across the whole list travels farther, so it takes longer.
    expect(farMove.durationMs).toBeGreaterThan(swap1.durationMs)

    await close()
  })

  test('Recommending an app bubbles when the network confirms', async ({ browser }) => {
    test.setTimeout(60000)
    await fundWithNative(createProductSigner().address)
    await createRevokedAttestation('host-playground').catch(() => {})
    const host = await startSignedHost({ name: 'smalltava.05', uri: `${DEV_PHRASE}//wallet` })
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      reducedMotion: 'no-preference'
    })
    const page = await context.newPage()

    // Given
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.category-tab')
    await frame.locator('.category-tab', { hasText: 'All' }).click()
    const card = frame.locator('.product-card[data-label="host-playground"]')
    await expect(card).toBeVisible({ timeout: 15000 })
    const upvote = card.locator('.product-card__upvote')

    // When
    await upvote.click()

    // Then
    await expect(card.locator('.product-card__bubble').first()).toBeVisible({ timeout: 15000 })
    await expect(frame.locator('.toast--visible')).toContainText('Recommended!', { timeout: 15000 })

    // Linger in headed runs so the bubbling is watchable; no-op in CI.
    if (process.env.HEADED === '1') await frame.waitForTimeout(4000)

    await page.close()
    await context.close()
    await host.close()
  })
})
