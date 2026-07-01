---
summary: "Browse caches cloud and user-controlled data in localStorage. This page documents the cache layout, write patterns, and TTL behavior."
title: "Local Storage Cache"
read_when:
  - Debugging stale data in the app list
  - Adding a new cache key
  - Reasoning about sync write volume
  - Investigating host SDK bridge traffic
---

Browse persists per-product cache state in `localStorage` through a single async wrapper.

Three kinds of data live there: cloud caches (apps, stores, address mappings), user-controlled lists (bookmarks, contacts), and query-result snapshots (followed apps, curated apps). All access funnels through [`lib/local-storage.ts`](../app/src/lib/local-storage.ts), which dispatches to the host SDK in iframe mode or `window.localStorage` standalone.

## Quick reference

| Key                  | Shape                              | Module                                                                         | TTL                        |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| `browse:labels`      | `LabelEntry[]`                     | [db/labels.ts](../app/src/db/labels.ts)                                        | `fetchedAt`, 24h           |
| `browse:stores`      | `StoreEntry[]`                     | [db/stores.ts](../app/src/db/stores.ts)                                        | none                       |
| `browse:addresses`   | `Record<h160, ss58>`               | [db/addresses.ts](../app/src/db/addresses.ts)                                  | none                       |
| `browse:bookmarks`   | `string[]`                         | [db/bookmarks.ts](../app/src/db/bookmarks.ts)                                   | none                       |
| `browse:following`   | `FollowedAccount[]`                | [state/following/api.ts](../app/src/state/following/api.ts)                     | none                       |
| `browse:followed`    | `{ apps: AppEntry[], timestamp }`  | [state/recommendations/cache.ts](../app/src/state/recommendations/cache.ts)    | timestamp, not enforced    |

All keys use the `browse:` prefix.

## Storage abstraction

The wrapper at [`lib/local-storage.ts`](../app/src/lib/local-storage.ts) exposes two async methods:

<ParamField path="readJSON" type="<T>(key) => Promise<T | null>">
  Reads a key, JSON-parses, returns null on parse failure.
</ParamField>

<ParamField path="writeJSON" type="<T>(key, value) => Promise<void>">
  JSON-encodes and writes. In hosted mode the call becomes a postMessage to the parent frame.
</ParamField>

<Note>
Even in standalone mode the wrapper keeps the async signature so callers do not branch on host vs standalone.
</Note>

## How writes happen

Sync-driven caches (`browse:labels`, `browse:stores`, `browse:addresses`) use whole-set writes: the caller holds the full in-memory map and writes it directly via `writeAllStores`, `writeAllLabels`, or `writeAllAddresses`. No read-merge-write. That saves a host bridge round-trip per call.

User-driven mutations (`addBookmark`, `addContact`, `setCachedFollowed`, `setCachedPcf`) rewrite the whole array on each call. The caches are small enough that the full rewrite is cheap.

## How reads flow into TanStack Query

`prefetchAllApps` and `prefetchPcfApps` seed the queryClient with `updatedAt: 0` so the UI renders instantly from cache while a background sync runs. Both prefetch and the queryFn share a single disk read via `loadInitialDiskState` to avoid double-loading.

## TTL behavior

Only `browse:labels` enforces a TTL of 24 hours, checked at sync start in [`syncAllApps`](../app/src/state/apps/queries.ts). Labels older than the TTL or missing `fetchedAt` (legacy entries) feed back into `flushLabelBatch` for re-fetching.


## Bridge traffic budget

The regression test at [tests/synchronization.spec.ts](../app/tests/synchronization.spec.ts) caps bridge traffic during a stale-cache resync at 5 MB per minute. Against the test fixture chain (127 stores, 4,890 labels) the 60-second sample sits at ~4.4 MB, comfortably under budget.
