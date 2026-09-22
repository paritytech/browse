/**
 * Local deployment history for each label.
 *
 * The chain keeps only the current contenthash, so the portal records what it
 * observes and what it changes in host local storage. The Deployments view
 * renders from this store, newest first, capped at twenty entries per label.
 */

import { createLocalKvStore, type LocalKvStore } from '@parity/product-sdk/local-storage'

export interface DeploymentEntry {
  cid: string
  /** Raw contenthash payload behind the CID, needed to replay it in a revert. */
  hashHex: string | null
  /** Manifest `version` field when the manifest carries one, else null. */
  version: string | null
  at: number
  source: 'observed' | 'edit' | 'revert'
}

const CAP = 20

let storePromise: Promise<LocalKvStore> | null = null

function ensureStore(): Promise<LocalKvStore> {
  storePromise ??= createLocalKvStore({ prefix: 'portal' })
  return storePromise
}

function keyOf(label: string): string {
  return `deployments:${label}`
}

/** The recorded deployments of a label, newest first. Empty when none. */
export async function readDeployments(label: string): Promise<DeploymentEntry[]> {
  try {
    const store = await ensureStore()
    return (await store.getJSON<DeploymentEntry[]>(keyOf(label))) ?? []
  } catch {
    return []
  }
}

/**
 * Record a deployment for a label.
 *
 * An observed entry whose CID already leads the history is skipped, so repeat
 * visits do not pile up duplicates. Edits and reverts always append. Returns
 * the updated history.
 */
export async function recordDeployment(
  label: string,
  entry: Omit<DeploymentEntry, 'at'>
): Promise<DeploymentEntry[]> {
  const history = await readDeployments(label)
  if (entry.source === 'observed' && history[0]?.cid === entry.cid) return history
  const next = [{ ...entry, at: Date.now() }, ...history].slice(0, CAP)
  try {
    const store = await ensureStore()
    await store.setJSON(keyOf(label), next)
  } catch {
    return history
  }
  return next
}
