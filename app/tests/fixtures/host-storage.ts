/**
 * The storage a host keeps for the product.
 *
 * The app writes its caches through the host, not into its own `localStorage`.
 * The test host keeps them in memory under a namespace the core derives from
 * the product id, and a host page reload starts that map empty, while a real
 * host persists it. The caching and reload specs are written against a host
 * that persists, so the helpers here mirror the map into the host page's
 * `localStorage` and restore it into each fresh runtime before the product's
 * first read.
 */
import type { Page } from '@playwright/test'

import { LOCALHOST_SELF_DOTNS } from '../../src/lib/config'

/** What the test host exposes on its page, for the parts the specs drive. */
export interface TestHostHandle {
  seedProductStorage(key: string, value: string): void
  getProductStorage(): Record<string, string>
}

declare global {
  interface Window {
    __TEST_HOST__?: TestHostHandle
  }
}

/** The core's namespace: `truapi:product-storage:v1:<id length>:<product id>:<key>`. */
export function productStorageKey(key: string): string {
  return `truapi:product-storage:v1:${LOCALHOST_SELF_DOTNS.length}:${LOCALHOST_SELF_DOTNS}:${key}`
}

/** The app's label cache, the entry the caching specs assert on. */
export const LABELS_KEY = 'browse:labels'

/** Where the mirror lives in the host page's own `localStorage`. */
export const MIRROR_KEY = 'e2e:product-storage'

const installed = new WeakSet<Page>()

/**
 * Make the host's product storage survive a reload of its page, for the rest of
 * this page's life. Install before the first navigation.
 */
export async function persistProductStorage(page: Page): Promise<void> {
  if (installed.has(page)) return
  installed.add(page)
  await page.addInitScript((mirrorKey) => {
    let host: unknown
    Object.defineProperty(window, '__TEST_HOST__', {
      configurable: true,
      get: () => host,
      set(value: TestHostHandle) {
        host = value
        try {
          const saved = JSON.parse(localStorage.getItem(mirrorKey) ?? '{}') as Record<
            string,
            string
          >
          for (const [k, v] of Object.entries(saved)) value.seedProductStorage(k, v)
        } catch {
          // an unreadable mirror just means a cold start
        }
        setInterval(() => {
          try {
            localStorage.setItem(mirrorKey, JSON.stringify(value.getProductStorage()))
          } catch {
            // ignore
          }
        }, 200)
      }
    })
  }, MIRROR_KEY)
}

/** Read one of the product's storage entries, parsed. */
export async function readProductStorage<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => {
    const raw = window.__TEST_HOST__?.getProductStorage()[k]
    return raw ? (JSON.parse(raw) as unknown) : null
  }, productStorageKey(key)) as Promise<T | null>
}

/** Write one of the product's storage entries, and the mirror a reload restores from. */
export async function writeProductStorage(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    ({ k, raw, mirrorKey }) => {
      const host = window.__TEST_HOST__
      if (!host) throw new Error('no test host on this page')
      host.seedProductStorage(k, raw)
      localStorage.setItem(mirrorKey, JSON.stringify(host.getProductStorage()))
    },
    { k: productStorageKey(key), raw: JSON.stringify(value), mirrorKey: MIRROR_KEY }
  )
}

/** Seed entries into the mirror, so the next page load starts with them. */
export async function seedProductStorage(
  page: Page,
  entries: Record<string, unknown>
): Promise<void> {
  const mirror: Record<string, string> = {}
  for (const [key, value] of Object.entries(entries)) {
    mirror[productStorageKey(key)] = JSON.stringify(value)
  }
  await page.addInitScript(
    ({ mirrorKey, seeded }) => {
      try {
        const existing = JSON.parse(localStorage.getItem(mirrorKey) ?? '{}') as Record<
          string,
          string
        >
        localStorage.setItem(mirrorKey, JSON.stringify({ ...existing, ...seeded }))
      } catch {
        localStorage.setItem(mirrorKey, JSON.stringify(seeded))
      }
    },
    { mirrorKey: MIRROR_KEY, seeded: mirror }
  )
}
