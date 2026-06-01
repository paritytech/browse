---
summary: "How a .dot label becomes a discoverable browse app via Personhood-gated, rolling-24h rate-limited Publisher events with paginated on-chain enumeration"
title: "Publishing Registry v2.0"
read_when:
  - You are adding a publish or unpublish call from the app or a script
  - You are debugging why a label is or is not appearing in browse
  - You are changing the personhood tier rules or daily caps
  - You are indexing `Published` / `Unpublished` events off-chain
  - You are reading the published-app set on-chain or via paginated multicall
  - You need to reason about trust assumptions (registrar upgrade, log immutability, personhood lag)
---

The browse registry is a single contract, [Publisher](../evm/src/Publisher.sol), that maintains the canonical set of currently-discoverable `.dot` apps.

`publish(label)` adds a label to the set. `unpublish(label)` removes it. Content lives elsewhere (dotNS content resolver, store contracts) and is joined off-chain by `labelhash`.

The registry is intentionally minimal. No on-chain content, no admin, no upgrade path, no per-publisher index. The published array, the per-label [`Publication`](../evm/src/interfaces/IPublisher.sol#L15) record, and the rate-limit ring are the only state. Clients reading "apps by Alice" page the global feed and filter on the `publisher` field client-side.

`Publisher` inherits [`Semver(2, 0, 0)`](../evm/src/Semver.sol) so `version()` returns `"2.0.0"`. See [versioning](#versioning).

## Quick reference

| Symbol | Source | Notes |
|---|---|---|
| `DOT_NODE` | [Publisher.sol:17](../evm/src/Publisher.sol#L17) | Precomputed namehash of `.dot` TLD |
| `event Published(publisher, labelNode, labelhash, timestamp)` | [IPublisher.sol:22](../evm/src/interfaces/IPublisher.sol#L22) | All three address/bytes32 args are `indexed` |
| `event Unpublished(publisher, labelNode, labelhash, timestamp)` | [IPublisher.sol:30](../evm/src/interfaces/IPublisher.sol#L30) | Same shape as `Published` for symmetric indexer reduce |
| `FULL_DAILY_LIMIT` | [Publisher.sol:33](../evm/src/Publisher.sol#L33) | 5 publishes per rolling `RATE_WINDOW` for status ≥ 2 |
| `LITE_DAILY_LIMIT` | [Publisher.sol:30](../evm/src/Publisher.sol#L30) | 3 publishes per rolling `RATE_WINDOW` for status == 1 |
| `PERSONHOOD` precompile | [Publisher.sol:13](../evm/src/Publisher.sol#L13) | `0x…0a010000`. Reads alias-accounts pallet |
| `PERSONHOOD_CONTEXT` | [Publisher.sol:24](../evm/src/Publisher.sol#L24) | `bytes32("dotns")`. Reuses the dotns ring root |
| `Publication` struct | [IPublisher.sol:15](../evm/src/interfaces/IPublisher.sol#L15) | `(publisher, timestamp, indexPlusOne)`. Also the storage row |
| `Publisher.getPublished(offset, limit)` | [Publisher.sol:143](../evm/src/Publisher.sol#L143) | Paginated read of labelhashes from the global feed |
| `Publisher.getPublishedAt(index)` | [Publisher.sol:138](../evm/src/Publisher.sol#L138) | Single labelhash by enumeration index |
| `Publisher.isPublished(labelhash)` | [Publisher.sol:128](../evm/src/Publisher.sol#L128) | O(1) "is this label live?" predicate |
| `Publisher.publicationOf(labelhash)` | [Publisher.sol:159](../evm/src/Publisher.sol#L159) | Direct lookup. Zero-valued struct when absent |
| `Publisher.publish(label)` | [Publisher.sol:69](../evm/src/Publisher.sol#L69) | Personhood-gated, rolling-window rate-limited |
| `Publisher.publishedCount()` | [Publisher.sol:133](../evm/src/Publisher.sol#L133) | Total live entries |
| `Publisher.registrar()` | [Publisher.sol:49](../evm/src/Publisher.sol#L49) | The configured `IDotnsRegistrar` |
| `Publisher.unpublish(label)` | [Publisher.sol:102](../evm/src/Publisher.sol#L102) | Ownership-only. No personhood gate. No rate-slot touch |
| `Publisher.version()` | [Semver.sol](../evm/src/Semver.sol) | Inherited via `Semver(2, 0, 0)` |
| `RATE_WINDOW` | [Publisher.sol:27](../evm/src/Publisher.sol#L27) | `1 days`. The rolling window for the per-publisher rate limit |

## Storage layout

Three pieces of state, plus the immutable registrar pointer.

- **`bytes32[] _published`**. Insertion-order list of labelhashes whose publications are currently live. One slot per live label.
- **`mapping(bytes32 => Publication) _publications`**. Per-label record. [`Publication`](../evm/src/interfaces/IPublisher.sol#L15) packs `address publisher (20) + uint64 timestamp (8) + uint32 indexPlusOne (4) = 32 bytes` into one slot. `indexPlusOne` is the 1-indexed position in `_published`, doubling as the "is published" flag and as the swap-and-pop pointer on removal. `indexPlusOne == 0` means the label is absent.
- **`mapping(address => PublishWindow) _windows`**. Per-publisher rate-limit ring. [`PublishWindow`](../evm/src/Publisher.sol#L40) packs five `uint48` timestamps into one slot (5 × 6 = 30 bytes). `uint48` overflows around year 8.9M, comfortably past contract lifetime.

One fresh publish writes two storage slots (`_published.push` and `_publications[lh]`) and rotates the ring. A republish writes one slot for the data refresh and rotates the ring.

## Publish flow

`publish(label)` performs four checks in order. Any failure reverts. No partial state.

1. **Non-empty label.** Empty string reverts with [`EmptyLabel`](../evm/src/interfaces/IPublisher.sol#L37).
2. **Ownership.** The label's `tokenId` (the `uint256` of `namehash(<label>.dot)`) is queried via [`IDotnsRegistrar.ownerOf`](../evm/src/interfaces/IDotnsRegistrar.sol#L14). A revert from the registrar (unminted token) and a wrong owner both surface as one error, [`NotOwner`](../evm/src/interfaces/IPublisher.sol#L39). One error for "doesn't exist" and "exists but not yours" keeps the caller contract simple.
3. **Personhood tier.** [`IPersonhood.personhoodStatus(msg.sender, "dotns")`](../evm/src/interfaces/IPersonhood.sol#L22) returns a tier.
   - `0` (None) reverts with [`NoPersonhood`](../evm/src/interfaces/IPublisher.sol#L38).
   - `1` (Lite) has a daily cap of `LITE_DAILY_LIMIT` (3).
   - `>= 2` (Full and any higher future tier) has a daily cap of `FULL_DAILY_LIMIT` (5). Treating unknown future tiers as Full is intentional so precompile upgrades cannot accidentally lock the contract down.
4. **Rate limit.** A fixed-size ring of the caller's last 5 publish timestamps lives in `_windows[msg.sender]`. The check counts entries strictly newer than `block.timestamp - RATE_WINDOW` and reverts with [`RateLimitExceeded(nextAvailableAt)`](../evm/src/interfaces/IPublisher.sol#L40) if the active count is already at the tier's cap. `nextAvailableAt` is the oldest active timestamp plus `RATE_WINDOW`. That value is the wall-clock when the next slot frees up. On pass, the ring is rotated (oldest dropped) and the current timestamp becomes the new `t0`.

On success, the publication is recorded (see [Recording semantics](#recording-semantics)) and [`Published(publisher, labelNode, labelhash, timestamp)`](../evm/src/interfaces/IPublisher.sol#L22) is emitted. All three address/bytes32 fields are indexed. `labelNode` is for namehash joins, `labelhash` for label-key joins against dotNS content resolver records.

### Recording semantics

After the gate, `publish` distinguishes two cases on `_publications[labelhash]`.

- **`indexPlusOne == 0` (new label).** Push the labelhash onto `_published`, write `(publisher, timestamp, indexPlusOne)` into `_publications[labelhash]`.
- **`indexPlusOne != 0` (already live).** Overwrite `publisher` and `timestamp` in place. `indexPlusOne` is unchanged because the array slot stays where it is. This covers both same-publisher republishes (refreshes the timestamp, no other state change) and transfer-then-republish by a new owner (refreshes publisher and timestamp on the existing global entry). Either way the call consumes a rate-limit slot.

The single global feed is intentional. The previous design also maintained a per-publisher list for cheap "show Alice's apps" reads. That was dropped because (a) the duplication tripled storage cost per publish, (b) `browse` reads the global feed via Multicall anyway, and (c) per-publisher filtering on a list capped by daily-publish throughput is trivial client-side.

### Why per-sender rate limits, not per-(sender, label)

An earlier draft considered keying the limit on `(msg.sender, labelhash)` to let multi-app developers publish all their apps without daily friction. That was rejected. `PopRules._priceValidatedName` returns `0` for any tier above `NoStatus`, so Lite users mint labels for gas only. A per-label limit collapses the spam ceiling to "labels owned," which is unbounded for verified users. It also opens a 2-account transfer shuttle. Alice publishes from `alice.dot`, transfers the token to Bob, Bob's `(bob, alice.dot)` slot is fresh and he publishes immediately. The per-sender ring denies both attacks. The cost is friction for legitimate multi-app developers. They trickle out at 3/day (Lite) or 5/day (Full). That trade-off is accepted. The Full tier exists precisely so verified developers feel less of the squeeze.

## Unpublish flow

`unpublish(label)` performs two checks. No personhood gate, no rate-limit read or write.

1. **Non-empty label.** Empty string reverts with [`EmptyLabel`](../evm/src/interfaces/IPublisher.sol#L37).
2. **Ownership.** Same `IDotnsRegistrar.ownerOf` check and same [`NotOwner`](../evm/src/interfaces/IPublisher.sol#L39) error as `publish`.

On success, the entry is removed from `_published` via swap-and-pop and the `_publications[labelhash]` record is deleted. Then [`Unpublished(publisher, labelNode, labelhash, timestamp)`](../evm/src/interfaces/IPublisher.sol#L30) is emitted with `msg.sender` as the publisher field. Calling `unpublish` on a label that was never published succeeds as a no-op against state and emits the event anyway. The live answer is still "not published."

### Why unpublish skips personhood and the rate limit

- **No personhood gate.** A publisher whose verification was revoked still needs to remove their own listings. Self-removal is not a spam vector because the only way to have a listing in the first place was to have passed the publish gate.
- **No rate-limit read or write.** Reading would block a retraction whenever the publisher is at cap, which is wrong UX. Writing would let a Lite user publish, unpublish, then publish again to dodge the daily limit. So `unpublish` leaves `_windows[msg.sender]` untouched.

Republishing a previously unpublished label goes through the normal `publish` flow with the normal daily cap.

## Reading the published set

Two paths, both consensus-canonical.

### State path (preferred for browse)

```solidity
uint256 total = publisher.publishedCount();
bytes32[] memory page = publisher.getPublished(0, 1000);
// Then fan out per entry, typically batched via Multicall3.
IPublisher.Publication memory pub = publisher.publicationOf(page[0]);
```

`getPublished(offset, limit)` returns labelhashes in insertion order. Removes use swap-and-pop, so **enumeration order is not stable across unpublishes**. A label removed mid-page swaps the tail into its slot. Clients that need a consistent snapshot should page within one block, or reduce by `labelhash` and treat the result as a set.

`publicationOf(labelhash)` returns the full `Publication` record. Use `indexPlusOne != 0` (or `isPublished`) to disambiguate "not published" from a true zero record.

Publisher does not store the original label string. Recover it via `IDotnsRegistrar.labelOf(uint256(labelNode))`, where `labelNode = keccak256(abi.encodePacked(DOT_NODE, labelhash))`. The registrar reads from the current owner's `LabelStore` and stays in sync across transfers via `_syncRecipientStore`. Storing the string twice (here and in dotns) would only ever create drift.

The current owner of any label is `IDotnsRegistrar.ownerOf(uint256(labelNode))`. Publisher does not mirror ownership state because it would always be a stale copy. The `publisher` field on the `Publication` record (and the `Published` event) records the caller of the last successful publish. For "who currently controls this label?" always ask the registrar.

For browse, the natural pattern is one paginated `getPublished` call followed by a Multicall3 batch with `publicationOf`, `labelOf`, `contenthash`, `text(node, "name")`, `text(node, "description")`, and (future) manifest records. One batch per ~30-label chunk. To show "apps by Alice," filter the assembled page by `pub.publisher == alice`. No separate on-chain call needed.

### Event path

`Published` and `Unpublished` events carry the same `labelhash` indexed field. An indexer reduces them per `labelhash` and takes the latest by `(blockNumber, logIndex)`. Useful when scanning history or running a light client that can't afford state reads.

## Personhood context

The `PERSONHOOD_CONTEXT` value (`bytes32("dotns")`) reuses dotns' application context so any account already verified for dotns can publish here without a separate ring-root broadcast. Publisher emits `publisher` in plain text in the `Published` event, so the per-context aliasing's anti-linkability benefit is unused. Collapsing onto dotns' context costs nothing observable on the read side and saves the chain-side bootstrap of a `"browse"` ring.

## Versioning

`Publisher` inherits [`Semver`](../evm/src/Semver.sol), which stores `(major, minor, patch)` as constructor-set immutables and exposes [`version()`](../evm/src/interfaces/ISemver.sol#L9) returning a stringified `"M.m.p"`. The pattern matches the attestation-protocol convention so any browse contract can be versioned the same way: `contract Foo is IFoo, Semver(M, m, p) { … }`.

The scheme tracks redeployments. The contract itself is immutable, so a "patch" is a new address at the same ABI.

- **MAJOR.** Breaking ABI change (renamed function, changed return type, changed event topic, removed event).
- **MINOR.** Additive change (new function, new event with a new topic, new pure helper).
- **PATCH.** Behaviour fix at the same ABI.

`v2.0.0` is a major bump from `v1.1.0`. The enumeration views now return raw labelhashes (callers compose with `publicationOf`), `CooldownActive` was replaced by `RateLimitExceeded`, `lastPublishedAt(address)` was removed in favour of the rolling-window ring, and the new `Publication` struct exposes `indexPlusOne` as a public field. Zero means not published, otherwise the value is the 1-indexed position in the global feed. The contract is pre-deployment at v2.

## What is not on-chain

- **App metadata.** Display name, icon, description, executables. All in dotNS text records (see [Product Manifest RFC](https://github.com/paritytech/triangle-js-sdks/pull/174)) and Bulletin chain CIDs.
- **Categories, ranking, social signals.** Client-side concerns. See [local-storage.md](./local-storage.md) for the cache layout.
- **Content hashes.** Deliberately not in `Published` or in Publisher state. Content lives on the dotNS content resolver. Embedding a hash here would create two sources of truth and bake event semantics into the contract forever.
- **The original label string.** `IDotnsRegistrar.labelOf(tokenId)` is the canonical source. Publisher only stores the labelhash.
- **The current label owner.** `IDotnsRegistrar.ownerOf(tokenId)` is the live answer. Mirroring it on Publisher would only ever be a stale copy.
- **A per-publisher index.** Filter the global feed by `publisher` client-side. An on-chain index was tried and reverted because the duplicated storage was not earning its keep.

## Trust assumptions

The contract has no admin, no upgrade, and no privileged callers. The only external trust roots are:

- **DotNS registrar.** `IDotnsRegistrar` is `immutable` in this contract, but the dotNS registrar implementation is an OpenZeppelin upgradeable proxy. A compromised dotNS governance can rewrite `ownerOf` to spoof ownership, which Publisher would honor blindly. The blast radius is total. The mitigation is not in this contract.
- **Personhood precompile.** The alias-accounts pallet receives ring roots from the People chain via XCM pub/sub. Status updates are eventually consistent. A recently-revoked verification retains publish ability for the XCM lag window. This is the steady state, not an attack edge.
- **Event log immutability.** Once a `Published` event is in a finalised block, it is in the log forever. An `Unpublished` retraction does not erase the prior payload, only declares the current state. Indexer reducers must take "latest event wins." Any UI that pivots on historical event content (for example cross-referencing old `Published` hashes) inherits the historical payload. This is a fundamental property of event-only registries, not a contract bug.

## Adding a new field

The contract is immutable. A new discovery signal (for example category, locale, modality) goes one of three places.

1. **A new event on a new Publisher deployment** with a bumped MAJOR or MINOR version.
2. **A separate contract** with its own indexable event, joined to Publisher by `labelhash`.
3. **A dotNS text record** on the label's subname, fetched lazily by clients.

Choice depends on whether the signal is required for discovery (event) or for rendering (text record).

## Related

- [Local storage cache](./local-storage.md)
