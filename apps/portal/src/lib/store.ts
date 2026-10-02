/**
 * The host local-storage namespace of the portal.
 *
 * One store serves every local concern, so the tracked domain list and the
 * deployment history share a namespace and a single host handle.
 */

import { createLocalKvStore, type LocalKvStore } from '@parity/product-sdk/local-storage'

let storePromise: Promise<LocalKvStore> | null = null

export function ensureStore(): Promise<LocalKvStore> {
  storePromise ??= createLocalKvStore({ prefix: 'portal' })
  return storePromise
}
