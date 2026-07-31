# @parity/browse-snapshots

Prefix autocomplete for `.dot` domains and usernames, read from verifiable content-addressed snapshots.

Enumerating every registered name on demand is far too slow for a search box. Instead a scheduled job crawls the whole set, publishes it as immutable gzipped blocks, and records where to find them. A client then answers a whole typing session with two block reads.

## Reading suggestions

One service per dataset, both over the same base:

```ts
import {
  BROWSE_POINTER_DOMAIN,
  DomainSnapshotService,
  UsernameSnapshotService
} from '@parity/browse-snapshots'
import { createHostBlockReader } from '@parity/browse-snapshots/host'

const source = {
  readBlock: createHostBlockReader(),
  network: genesis,
  pointer: {
    read: async (target, data) => (await ensureSdk()).reviveCall(target, data),
    contentResolver: network.CONTENT_RESOLVER,
    domain: BROWSE_POINTER_DOMAIN
  }
}

const domains = new DomainSnapshotService(source)
const usernames = new UsernameSnapshotService(source)

await domains.suggest('cal') // ['calculator', 'calendar', …]
await usernames.suggest('al') // [{ username: 'alice', account: '5…' }, …]
```

Each service knows the one thing that makes its dataset different: which text record points at it, how a line sorts, and how a line becomes an entry. Everything else, the manifest and shard caching, the binary search, the failure handling, lives on `SnapshotService`. Subclass it to add a dataset.

A username entry carries the account that owns the name, so selecting a suggestion needs no further lookup.

`readBlock` resolves a block by its blake2b-256 digest. In a hosted client that wraps the host preimage bridge. Elsewhere it can read Bulletin directly. Nothing else in the package knows how bytes are fetched.

`suggest` never throws. Any failure to resolve, decompress, or parse yields no suggestions, because autocomplete that disappears is recoverable and autocomplete that throws into render is not.

## Finding the current snapshot

Snapshot blocks are immutable, so their CIDs change on every crawl. Baking one into a client pins it to whatever was current on the day it shipped, and republishing the client hourly does not help because consumers resolve through a lockfile.

The publisher records the manifest CID in a text record on a fixed name instead. Give a service a `pointer` and it reads its own record, `snapshot.domains` or `snapshot.usernames`, on that name.

Two escapes from that default. `manifestCid` pins one snapshot, which is what the test suites do. `resolveManifestCid` supplies the CID some other way, for a client that distributes it outside the chain. A pinned CID beats both.

## Publishing

The producer side lives behind two node-only subpaths, so transaction signing never reaches a browser bundle.

```ts
import { crawlUsernames } from '@parity/browse-snapshots/crawl'
import { publishSnapshot, writeSnapshotPointer } from '@parity/browse-snapshots/publish'
```

`crawlDomains` and `crawlUsernames` return sorted lines. Sorting is load-bearing: the reader binary-searches each shard and stops at the first non-matching entry, so unsorted input silently truncates results.

`publishSnapshot` shards the lines by two-character prefix, gzips each shard, and stores every block on Bulletin. The manifest block goes last, so a run that dies partway never advertises shards it did not store. `writeSnapshotPointer` then records the manifest CID, and must be signed by the account that owns the name.

## Format

Every block is a `CIDv1(raw, blake2b-256)`, which is what the host preimage bridge resolves. The bridge only returns bytes whose hash matches the key it was given, so the CID is the integrity check and these blocks must never be read over an IPFS gateway instead.

`src/format.ts` holds both directions of that agreement. The publisher and the reader have to match byte for byte on sharding, compression, and content addressing, and two copies of that agreement drift.
