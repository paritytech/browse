/**
 * Covers the project detail page: the header records, the overview hero, the
 * Domains tab, and the settings edit and unpublish paths, all against the
 * live network.
 *
 * Uses the TrUAPI test host to stand up a host around the app. The
 * record reads hit the real network for the active genesis, so the specs
 * target `browse`, a label published there with a manifest.
 */

import type { BrowserContext, Frame } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { TLD, WEB_DOMAIN } from '../src/lib/config'
import {
  getProductFrame,
  gotoDetail,
  navigateToTestHost,
  startBareHost,
  startSignedHost,
  startUnsignedHost
} from './utils'

test.describe('Project detail header', () => {
  let host: Awaited<ReturnType<typeof startUnsignedHost>>
  let context: BrowserContext
  let frame: Frame

  test.beforeAll(async ({ browser }) => {
    host = await startUnsignedHost()
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await context.newPage()
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.toolbar')
    await gotoDetail(frame, 'browse')
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('shows the manifest name and description', async () => {
    // Then
    await expect(frame.locator('.detail-name')).toHaveText('Browse', { timeout: 30_000 })
    await expect(frame.locator('.detail-desc')).toHaveText('Home for privacy apps.')
    await expect(frame.locator('.card-domain')).toHaveText(`browse.${WEB_DOMAIN}`)
  })

  test('falls back to the letter avatar while the icon preimage is unavailable', async () => {
    // Then
    await expect(frame.locator('.avatar-lg')).toHaveText('B')
    await expect(frame.locator('.avatar-img')).toHaveCount(0)
  })

  test('the overview hero shows the live production deployment', async () => {
    // Given
    await gotoDetail(frame, 'browse')

    // Then
    await expect(frame.locator('.hero-status')).toHaveText('Ready', { timeout: 30_000 })
    await expect(frame.locator('.fact', { hasText: 'Publisher' })).toContainText('0x')
    await expect(frame.locator('.fact', { hasText: 'Content' })).toContainText('baf')
    await expect(frame.getByRole('link', { name: 'Visit' })).toHaveAttribute(
      'href',
      `https://browse.${WEB_DOMAIN}`
    )
    await expect(frame.getByRole('button', { name: 'Rollback' })).toBeDisabled()
  })

  test('the Domains tab lists the root, the modalities, and the gateway', async () => {
    // Given
    await gotoDetail(frame, 'browse')

    // When
    await frame.getByRole('tab', { name: 'Domains' }).click()

    // Then
    await expect(frame.locator('.domain-name')).toHaveText(
      [
        `browse.${TLD}`,
        `app.browse.${TLD}`,
        `widget.browse.${TLD}`,
        `worker.browse.${TLD}`,
        `browse.${WEB_DOMAIN}`
      ],
      { timeout: 30_000 }
    )
    await expect(
      frame
        .locator('.domain-row', { has: frame.getByText(`app.browse.${TLD}`) })
        .locator('.domain-sub')
    ).toContainText('baf')
    await expect(
      frame
        .locator('.domain-row', { has: frame.getByText(`worker.browse.${TLD}`) })
        .locator('.domain-sub')
    ).toHaveText('No content')
    await expect(
      frame
        .locator('.domain-row', { hasText: `browse.${WEB_DOMAIN}` })
        .getByRole('link', { name: 'Open' })
    ).toHaveAttribute('href', `https://browse.${WEB_DOMAIN}`)
  })

  test('the settings cards prefill from the live records', async () => {
    // Given
    await gotoDetail(frame, 'browse')

    // When
    await frame.getByRole('tab', { name: 'Settings' }).click()

    // Then
    await expect(frame.getByPlaceholder('Display name')).toHaveValue('Browse', {
      timeout: 30_000
    })
    await expect(frame.getByPlaceholder('Description')).toHaveValue('Home for privacy apps.')
  })

  test('picking an icon resolves the preimage round trip and shows its CID', async () => {
    // Given
    await gotoDetail(frame, 'browse')
    await frame.getByRole('tab', { name: 'Settings' }).click()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )

    // When
    await frame
      .locator('input[type="file"]')
      .setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png })

    // Then
    await expect(frame.locator('.icon-cid')).toContainText('bafk2bzace')
    await expect(frame.locator('.icon-preview')).toBeVisible()
  })

  test('the Deployments tab records the observed deployment as Current', async () => {
    // Given
    await gotoDetail(frame, 'browse')

    // When
    await frame.getByRole('tab', { name: 'Deployments' }).click()

    // Then
    await expect(frame.locator('.deploy-item')).toHaveCount(1, { timeout: 30_000 })
    await expect(frame.locator('.deploy-cid')).toContainText('baf')
    await expect(frame.locator('.deploy-pill')).toHaveText('Current')
    await expect(frame.locator('.deploy-source')).toHaveText('Observed')
    await expect(frame.locator('.deploy-revert')).toHaveCount(0)
  })

  test('the Analytics tab shows the recommendation total read from the network', async () => {
    // Given
    await gotoDetail(frame, 'browse')

    // When
    await frame.getByRole('tab', { name: 'Analytics' }).click()

    // Then
    const panel = frame.locator('.analytics-empty')
    await expect(panel.locator('.hero-title')).toHaveText('Recommendations')
    await expect(panel).toContainText(`How many people recommend browse.${TLD} in browse.`)
    await expect(panel.locator('.kpi-label')).toHaveText(['Total'])
    await expect(panel.locator('.kpi-value')).toHaveText(/^[\d,]+$/, { timeout: 30_000 })
    // No recommendations reads as the empty state, any number as the chart.
    await expect(panel.locator('.empty, .chart')).toBeVisible()
  })

  test('repeat visits do not duplicate the observed deployment', async () => {
    // Given
    await gotoDetail(frame, 'zzznorecords')
    await expect(frame.locator('.detail-name')).toHaveText(`zzznorecords.${TLD}`, {
      timeout: 30_000
    })

    // When
    await gotoDetail(frame, 'browse')
    await frame.getByRole('tab', { name: 'Deployments' }).click()

    // Then
    await expect(frame.locator('.deploy-item')).toHaveCount(1, { timeout: 30_000 })
  })
})

test.describe('Project detail for an empty label', () => {
  let host: Awaited<ReturnType<typeof startUnsignedHost>>
  let context: BrowserContext
  let frame: Frame

  test.beforeAll(async ({ browser }) => {
    host = await startUnsignedHost()
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await context.newPage()
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.toolbar')
    await gotoDetail(frame, 'zzznorecords')
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('falls back to the domain name for a label with no records', async () => {
    // Then
    await expect(frame.locator('.detail-name')).toHaveText(`zzznorecords.${TLD}`, {
      timeout: 30_000
    })
    await expect(frame.locator('.detail-desc')).toHaveCount(0)
  })

  test('an unpublished label reads Not published with its domain fact intact', async () => {
    // Then
    await expect(frame.locator('.hero-status')).toHaveText('Not published', { timeout: 30_000 })
    await expect(frame.locator('.fact', { hasText: 'Domain' })).toContainText(`zzznorecords.${TLD}`)
  })

  test('a label with no history shows the honest local history empty state', async () => {
    // When
    await frame.getByRole('tab', { name: 'Deployments' }).click()

    // Then
    await expect(frame.locator('.empty-state')).toContainText('records history locally', {
      timeout: 30_000
    })
  })
})

test('unpublish from settings takes two steps, errors, and signs nothing', async ({ browser }) => {
  // Given
  const host = await startSignedHost('alice')
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await navigateToTestHost(page, host.url)
  const frame = await getProductFrame(page, '.toolbar')
  await gotoDetail(frame, 'browse')
  await frame.getByRole('tab', { name: 'Settings' }).click()

  // When
  await frame.getByRole('button', { name: 'Unpublish', exact: true }).click({ timeout: 30_000 })

  // Then
  await expect(frame.getByRole('button', { name: 'Confirm unpublish' })).toBeVisible()
  await expect(frame.locator('.feedback-error')).toHaveCount(0)

  // When
  await frame.getByRole('button', { name: 'Confirm unpublish' }).click()

  // Then
  await expect(frame.locator('.settings-danger .feedback-error')).toBeVisible({
    timeout: 25_000
  })
  const signed = await page.evaluate(
    () =>
      (
        window as unknown as { __TEST_HOST__: { getSigningLog(): unknown[] } }
      ).__TEST_HOST__.getSigningLog().length
  )
  expect(signed).toBe(0)

  await context.close()
  await host.close()
})

test('saving a name without authority errors and signs nothing', async ({ browser }) => {
  // Given
  const host = await startSignedHost('alice')
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await navigateToTestHost(page, host.url)
  const frame = await getProductFrame(page, '.toolbar')
  await gotoDetail(frame, 'browse')
  await frame.getByRole('tab', { name: 'Settings' }).click()
  await expect(frame.getByPlaceholder('Display name')).toHaveValue('Browse', { timeout: 30_000 })

  // When
  await frame.getByPlaceholder('Display name').fill('Renamed')
  await frame
    .locator('.settings-card', { hasText: 'Display Name' })
    .getByRole('button', { name: 'Save' })
    .click()

  // Then
  await expect(frame.locator('.settings-card .feedback-error')).toBeVisible({ timeout: 25_000 })
  const signed = await page.evaluate(
    () =>
      (
        window as unknown as { __TEST_HOST__: { getSigningLog(): unknown[] } }
      ).__TEST_HOST__.getSigningLog().length
  )
  expect(signed).toBe(0)

  await context.close()
  await host.close()
})

test('a failed chain read surfaces an inline error in the hero', async ({ browser }) => {
  // Given
  const host = await startBareHost()
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await navigateToTestHost(page, host.url)
  const frame = await getProductFrame(page, '.toolbar')

  // When
  await gotoDetail(frame, 'browse')

  // Then
  await expect(frame.locator('.hero-deploy .feedback-error')).toBeVisible({ timeout: 30_000 })

  await context.close()
  await host.close()
})
