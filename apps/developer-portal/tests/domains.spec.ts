/**
 * Covers adding a domain: snapshot suggestions, normalization, and the error
 * path when the connected account cannot publish.
 *
 * Uses the host-api-test-sdk to stand up a mock host around the app.
 */

import type { BrowserContext, Frame, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { getProductFrame, navigateToTestHost, seedSnapshotPreimage, startSignedHost } from './utils'

test.describe('Add a domain', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext
  let page: Page
  let frame: Frame

  test.beforeAll(async ({ browser }) => {
    host = await startSignedHost('alice')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    page = await context.newPage()
    await navigateToTestHost(page, host.url, { authenticate: true })
    frame = await getProductFrame(page, '.toolbar')
    await seedSnapshotPreimage(page)
    await frame.getByRole('button', { name: 'Add new' }).click()
    await expect(frame.locator('.field input')).toBeVisible()
  })

  test.afterAll(async () => {
    await context?.close()
    await host?.close()
  })

  test('typing a prefix lists snapshot suggestions', async () => {
    // When
    await frame.locator('.field input').fill('my')

    // Then
    await expect(frame.locator('.suggest-item', { hasText: 'myapp.dot' })).toBeVisible({
      timeout: 15_000
    })
    await expect(frame.locator('.suggest-item', { hasText: 'mydomain.dot' })).toBeVisible()
  })

  test('a mixed case prefix still matches through normalization', async () => {
    // When
    await frame.locator('.field input').fill('MYA')

    // Then
    await expect(frame.locator('.suggest-item', { hasText: 'myapp.dot' })).toBeVisible()
  })

  test('clicking a suggestion fills the bare label and closes the list', async () => {
    // Given
    await frame.locator('.field input').fill('my')
    await expect(frame.locator('.suggest')).toBeVisible()

    // When
    await frame.locator('.suggest-item', { hasText: 'myapp.dot' }).click()

    // Then
    await expect(frame.locator('.field input')).toHaveValue('myapp')
    await expect(frame.locator('.suggest')).toHaveCount(0)
  })

  test('the Add button stays disabled while the input is empty', async () => {
    // When
    await frame.locator('.field input').fill('')

    // Then
    await expect(frame.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  test('adding a domain the account cannot publish errors and signs nothing', async () => {
    // When
    await frame.locator('.field input').fill('browse')
    await frame.getByRole('button', { name: 'Add' }).click()

    // Then
    await expect(frame.locator('.feedback-error')).toBeVisible({ timeout: 25_000 })
    const signed = await page.evaluate(
      () =>
        (
          window as unknown as { __TEST_HOST__: { getSigningLog(): unknown[] } }
        ).__TEST_HOST__.getSigningLog().length
    )
    expect(signed).toBe(0)
    const permissions = await page.evaluate(
      () =>
        (
          window as unknown as { __TEST_HOST__: { getPermissionLog(): unknown[] } }
        ).__TEST_HOST__.getPermissionLog().length
    )
    expect(permissions).toBe(0)
  })
})

test('an unauthenticated host still fails an add before anything signs', async ({ browser }) => {
  // Given
  const host = await startSignedHost('alice')
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await navigateToTestHost(page, host.url)
  const frame = await getProductFrame(page, '.toolbar')

  // When
  await frame.getByRole('button', { name: 'Add new' }).click()
  await frame.locator('.field input').fill('browse')
  await frame.getByRole('button', { name: 'Add' }).click()

  // Then
  await expect(frame.locator('.feedback-error')).toBeVisible({ timeout: 25_000 })
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

test.describe('Add a domain with the owner fixture', () => {
  test.skip(
    !process.env.E2E_OWNER_MNEMONIC || !process.env.E2E_OWNER_USERNAME,
    'needs the owner fixture env'
  )

  test('adding an owned domain shows its card', async ({ browser }) => {
    // Given
    const host = await startSignedHost({
      name: process.env.E2E_OWNER_USERNAME!,
      uri: process.env.E2E_OWNER_MNEMONIC!
    })
    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await context.newPage()
    await navigateToTestHost(page, host.url, { authenticate: true })
    const frame = await getProductFrame(page, '.toolbar')
    const label = process.env.E2E_OWNER_LABEL ?? process.env.E2E_OWNER_USERNAME!

    // When
    await frame.getByRole('button', { name: 'Add new' }).click()
    await frame.locator('.field input').fill(label)
    await frame.getByRole('button', { name: 'Add' }).click()

    // Then
    await expect(frame.locator('.card', { hasText: `${label}.dot` })).toBeVisible({
      timeout: 120_000
    })
    await expect(frame.locator('.card .card-meta')).toContainText('0x')
    await expect(frame.locator('.card .card-sparkline')).toBeEmpty()

    // When
    await frame.getByRole('button', { name: 'List view' }).click()

    // Then
    await expect(frame.locator('.products')).toHaveClass(/list/)

    // When
    await frame.locator('.search input').fill('zzznomatch')

    // Then
    await expect(frame.locator('.empty-state')).toContainText('zzznomatch')

    await context.close()
    await host.close()
  })
})
