/**
 * Covers adding a domain: snapshot suggestions, normalization, and tracking.
 *
 * Adding is local. It records the label the portal tracks and opens its detail
 * page, and publishing is a separate step there, so an add signs nothing and
 * needs no session. The specs add `calculator`, the registry fixture app that
 * the registry suite publishes, so its detail page has records to show.
 *
 * Uses the TrUAPI test host to stand up a host around the app.
 */

import type { BrowserContext, Frame, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers'

import { TLD, WEB_DOMAIN } from '../src/lib/config'
import {
  getProductFrame,
  navigateToTestHost,
  seedSnapshotPreimage,
  startSignedHost,
  startUnsignedHost
} from './utils'

/** The registry fixture app, see apps/registry/tests/fixture-projects/calculator. */
const LABEL = 'calculator'

test.describe('Add a domain', () => {
  let host: Awaited<ReturnType<typeof startSignedHost>>
  let context: BrowserContext
  let page: Page
  let frame: Frame

  test.beforeAll(async ({ browser }) => {
    host = await startSignedHost('alice')
    context = await browser.newContext({ ignoreHTTPSErrors: true })
    page = await context.newPage()
    await navigateToTestHost(page, host.url)
    frame = await getProductFrame(page, '.toolbar')
    await seedSnapshotPreimage(page)
    await frame.locator('.toolbar').getByRole('button', { name: 'Add new' }).click()
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
    await expect(frame.locator('.suggest-item', { hasText: `myapp.${TLD}` })).toBeVisible({
      timeout: 15_000
    })
    await expect(frame.locator('.suggest-item', { hasText: `mydomain.${TLD}` })).toBeVisible()
  })

  test('a mixed case prefix still matches through normalization', async () => {
    // When
    await frame.locator('.field input').fill('MYA')

    // Then
    await expect(frame.locator('.suggest-item', { hasText: `myapp.${TLD}` })).toBeVisible()
  })

  test('clicking a suggestion fills the bare label and closes the list', async () => {
    // Given
    await frame.locator('.field input').fill('my')
    await expect(frame.locator('.suggest')).toBeVisible()

    // When
    await frame.locator('.suggest-item', { hasText: `myapp.${TLD}` }).click()

    // Then
    await expect(frame.locator('.field input')).toHaveValue('myapp')
    await expect(frame.locator('.suggest')).toHaveCount(0)
  })

  test('the Add button stays disabled while the input is empty', async () => {
    // When
    await frame.locator('.field input').fill('')

    // Then
    await expect(frame.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  })

  test('adding a domain tracks it, opens its detail page, and signs nothing', async () => {
    // When
    await frame.locator('.field input').fill(LABEL)
    await frame.getByRole('button', { name: 'Add', exact: true }).click()

    // Then
    await expect(frame.locator('.detail-name')).toHaveText('Calculator', { timeout: 30_000 })
    await expect(frame.locator('.detail-head .card-domain')).toHaveText(`${LABEL}.${WEB_DOMAIN}`)

    // When
    await frame.locator('.nav-item', { hasText: 'Products' }).click()

    // Then
    await expect(
      frame.locator('.card .card-domain', { hasText: `${LABEL}.${WEB_DOMAIN}` })
    ).toBeVisible()
    await expect(frame.locator('.feedback-error')).toHaveCount(0)
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

test('an unauthenticated host still adds a domain without signing', async ({ browser }) => {
  // It boots its own host, which comes on top of the waits below.
  test.setTimeout(90_000)
  // Given
  const host = await startUnsignedHost()
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  await navigateToTestHost(page, host.url)
  const frame = await getProductFrame(page, '.toolbar')

  // When
  await frame.locator('.toolbar').getByRole('button', { name: 'Add new' }).click()
  await frame.locator('.field input').fill(LABEL)
  await frame.getByRole('button', { name: 'Add', exact: true }).click()

  // Then
  await expect(frame.locator('.detail-name')).toHaveText('Calculator', { timeout: 30_000 })
  await expect(frame.locator('.detail-head .card-domain')).toHaveText(`${LABEL}.${WEB_DOMAIN}`)

  // When
  await frame.locator('.nav-item', { hasText: 'Products' }).click()

  // Then
  await expect(
    frame.locator('.card .card-domain', { hasText: `${LABEL}.${WEB_DOMAIN}` })
  ).toBeVisible()
  await expect(frame.locator('.feedback-error')).toHaveCount(0)
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
    // It boots its own host, which comes on top of the waits below.
    test.setTimeout(180_000)
    // Given
    // The host activates a session from 32 bytes of entropy, so the owner
    // mnemonic has to be a 24-word one, and its username has to be owned by the
    // identity account the host derives from it, not by the mnemonic root.
    const host = await startSignedHost({
      name: process.env.E2E_OWNER_USERNAME!,
      entropy: mnemonicToEntropy(process.env.E2E_OWNER_MNEMONIC!)
    })
    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await context.newPage()
    await navigateToTestHost(page, host.url)
    const frame = await getProductFrame(page, '.toolbar')
    const label = process.env.E2E_OWNER_LABEL ?? process.env.E2E_OWNER_USERNAME!

    // When
    await frame.locator('.toolbar').getByRole('button', { name: 'Add new' }).click()
    await frame.locator('.field input').fill(label)
    await frame.getByRole('button', { name: 'Add', exact: true }).click()

    // Then
    await expect(frame.locator('.card', { hasText: `${label}.${TLD}` })).toBeVisible({
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
