/**
 * The snapshot services this client reads suggestions from.
 *
 * One instance per dataset for the lifetime of the page, so the manifest and any
 * shard already fetched are reused across every keystroke. Both read blocks
 * through the host preimage bridge, and both fall back to the pointer record
 * when the build did not pin a snapshot.
 */

import {
  createHostBlockReader,
  DomainSnapshotService,
  type SnapshotServiceOptions,
  UsernameSnapshotService
} from '@parity/browse-sdk/snapshots'

import { reviveCall } from './client'
import {
  ASSETHUB_GENESIS,
  DOMAINS_SNAPSHOT_CID,
  NETWORK,
  SELF_DOTNS,
  USERNAMES_SNAPSHOT_CID
} from './config'

const source: SnapshotServiceOptions = {
  readBlock: createHostBlockReader(),
  network: ASSETHUB_GENESIS,
  // Read the record through the shared gated caller rather than the raw sdk.
  // It is the only chain read in the suggestion path, and the service leaves
  // timeouts to its caller, so going direct would leave it unbounded. This
  // inherits the rate gate, the 8s timeout, and the reset-and-retry.
  pointer: {
    read: reviveCall,
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
