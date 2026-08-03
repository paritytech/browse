/**
 * The snapshot services this client reads suggestions from.
 *
 * One instance per dataset for the lifetime of the page, so the manifest and any
 * shard already fetched are reused across every keystroke. Both read blocks
 * through the host preimage bridge, and both fall back to the pointer record
 * when the build did not pin a snapshot.
 */

import {
  DomainSnapshotService,
  type SnapshotServiceOptions,
  UsernameSnapshotService
} from '@parity/browse-sdk/snapshots'
import { getPreimageManager } from '@parity/product-sdk/host'

import { ensureApi } from './client'
import {
  ASSETHUB_GENESIS,
  DOMAINS_SNAPSHOT_CID,
  NETWORK,
  SELF_DOTNS,
  USERNAMES_SNAPSHOT_CID
} from './config'

const source: SnapshotServiceOptions = {
  // Both providers arrive asynchronously and can decline, which the service
  // already treats as no suggestions.
  preimageProvider: getPreimageManager,
  networkProvider: ensureApi,
  network: ASSETHUB_GENESIS,
  // One record read per session, memoized, so it skips the rate gate that paces
  // the bulk chain reads without adding meaningful load.
  pointer: {
    contentResolver: NETWORK.CONTENT_RESOLVER,
    domain: SELF_DOTNS
  }
}

export const domainService = new DomainSnapshotService({
  ...source,
  manifestCid: DOMAINS_SNAPSHOT_CID
})

export const usernameService = new UsernameSnapshotService({
  ...source,
  manifestCid: USERNAMES_SNAPSHOT_CID
})
