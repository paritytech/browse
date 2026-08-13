---
summary: "How a .dot label becomes a discoverable browse app via proof-of-personhood-gated, rolling-24h rate-limited Publisher events with paginated enumeration"
title: "Publishing Registry v3.0"
read_when:
  - You are adding a publish or unpublish call from the app or a script
  - You are debugging why a label is or is not appearing in browse
  - You are changing the personhood tier rules or daily caps
  - You are generating or verifying the ring-membership proof a publish requires
  - You are indexing `Published` / `Unpublished` events off-chain
  - You are reading the published-app set on-chain or via paginated multicall
  - You need to reason about trust assumptions (registrar upgrade, log immutability, personhood lag)
---

The browse registry is a single contract, [Publisher](../evm/src/Publisher.sol), that maintains the canonical set of currently-discoverable `.dot` apps.

`publish(label, request)` adds a label to the set, where `request` is a ring-membership proof of personhood. `unpublish(label)` removes it. Content lives elsewhere (dotNS content resolver, store contracts) and is joined off-chain by `labelhash`.

The registry is intentionally minimal. No stored content, no admin, no upgrade path, no per-publisher index. The published array, the per-label [`Publication`](../evm/src/interfaces/IPublisher.sol#L16) record, and the rate-limit ring are the only state. Clients reading "apps by Alice" page the global feed and filter on the `publisher` field client-side.

`Publisher` inherits [`Semver(3, 0, 0)`](../evm/src/Semver.sol) so `version()` returns `"3.0.0"`. See [versioning](#versioning).

## Quick reference

| Symbol | Source | Notes |
|---|---|---|
| `tldNode` | [Publisher.sol:20](../evm/src/Publisher.sol#L20) | Namehash of the TLD node, set per network at construction |
| `event Published(publisher, labelNode, labelhash, timestamp)` | [IPublisher.sol:23](../evm/src/interfaces/IPublisher.sol#L23) | All three address/bytes32 args are `indexed` |
| `event Unpublished(publisher, labelNode, labelhash, timestamp)` | [IPublisher.sol:31](../evm/src/interfaces/IPublisher.sol#L31) | Same shape as `Published` for symmetric indexer reduce |
| `FULL_DAILY_LIMIT` | [Publisher.sol:36](../evm/src/Publisher.sol#L36) | 5 publishes per rolling `RATE_WINDOW` for status ≥ 2 |
| `LITE_DAILY_LIMIT` | [Publisher.sol:33](../evm/src/Publisher.sol#L33) | 1 publish per rolling `RATE_WINDOW` for status == 1 |
| `PERSONHOOD` precompile | [Publisher.sol:16](../evm/src/Publisher.sol#L16) | `0x…0a010000`. Verifies ring-membership proofs |
| `PERSONHOOD_CONTEXT` | [Publisher.sol:27](../evm/src/Publisher.sol#L27) | `bytes32("dotns")`. Reuses the dotns ring root |
| `ProofVerificationRequest` struct | [IPersonhood.sol:27](../evm/src/interfaces/IPersonhood.sol#L27) | The proof bundle a publisher submits |
| `Publication` struct | [IPublisher.sol:16](../evm/src/interfaces/IPublisher.sol#L16) | `(publisher, timestamp, indexPlusOne)`. Also the storage row |
| `Publisher.getPublished(offset, limit)` | [Publisher.sol:158](../evm/src/Publisher.sol#L158) | Paginated read of labelhashes from the global feed |
| `Publisher.getPublishedAt(index)` | [Publisher.sol:153](../evm/src/Publisher.sol#L153) | Single labelhash by enumeration index |
| `Publisher.isPublished(labelhash)` | [Publisher.sol:143](../evm/src/Publisher.sol#L143) | O(1) "is this label live?" predicate |
| `Publisher.publicationOf(labelhash)` | [Publisher.sol:174](../evm/src/Publisher.sol#L174) | Direct lookup. Zero-valued struct when absent |
| `Publisher.publish(label, request)` | [Publisher.sol:80](../evm/src/Publisher.sol#L80) | Proof-gated, rolling-window rate-limited |
| `Publisher.getPublishDigest(publisher, labelhash)` | [Publisher.sol:183](../evm/src/Publisher.sol#L183) | The bytes a publisher must bind into their proof |
| `Publisher.publishedCount()` | [Publisher.sol:148](../evm/src/Publisher.sol#L148) | Total live entries |
| `Publisher.registrar()` | [Publisher.sol:52](../evm/src/Publisher.sol#L52) | The configured `IDotnsRegistrar` |
| `Publisher.unpublish(label)` | [Publisher.sol:117](../evm/src/Publisher.sol#L117) | Ownership-only. No personhood gate. No rate-slot touch |
| `Publisher.version()` | [Semver.sol](../evm/src/Semver.sol) | Inherited via `Semver(4, 0, 0)` |
| `RATE_WINDOW` | [Publisher.sol:30](../evm/src/Publisher.sol#L30) | `1 days`. The rolling window for the per-person rate limit |

## Storage layout

Three pieces of state, plus the immutable registrar pointer.

- **`bytes32[] _published`**. Insertion-order list of labelhashes whose publications are currently live. One slot per live label.
- **`mapping(bytes32 => Publication) _publications`**. Per-label record. [`Publication`](../evm/src/interfaces/IPublisher.sol#L16) packs `address publisher (20) + uint64 timestamp (8) + uint32 indexPlusOne (4) = 32 bytes` into one slot. `indexPlusOne` is the 1-indexed position in `_published`, doubling as the "is published" flag and as the swap-and-pop pointer on removal. `indexPlusOne == 0` means the label is absent.
- **`mapping(bytes32 => PublishWindow) _windows`**. Per-person rate-limit ring, keyed by the context alias the proof derives, not by the caller address. [`PublishWindow`](../evm/src/Publisher.sol#L43) packs five `uint48` timestamps into one slot (5 × 6 = 30 bytes). `uint48` overflows around year 8.9M, comfortably past contract lifetime.

One fresh publish writes two storage slots (`_published.push` and `_publications[lh]`) and rotates the ring. A republish writes one slot for the data refresh and rotates the ring.

## Publish flow

`publish(label, request)` performs four checks in order. Any failure reverts. No partial state.

1. **Non-empty label.** Empty string reverts with [`EmptyLabel`](../evm/src/interfaces/IPublisher.sol#L38).
2. **Ownership.** The label's `tokenId` (the `uint256` of `namehash(<label>.dot)`) is queried via [`IDotnsRegistrar.ownerOf`](../evm/src/interfaces/IDotnsRegistrar.sol#L14). A revert from the registrar (unminted token) and a wrong owner both surface as one error, [`NotOwner`](../evm/src/interfaces/IPublisher.sol#L41). One error for "doesn't exist" and "exists but not yours" keeps the caller contract simple.
3. **Personhood proof.** [`IPersonhood.personhoodInfoByProof(request)`](../evm/src/interfaces/IPersonhood.sol#L49) verifies the submitted ring-membership proof. See [Personhood proof](#personhood-proof) for what the contract rewrites before calling. A rejected proof reverts with [`NoPersonhood`](../evm/src/interfaces/IPublisher.sol#L40). The tier claimed in `request.expectedStatus` sets the cap.
   - `1` (Lite) has a daily cap of `LITE_DAILY_LIMIT` (1).
   - Anything else has a daily cap of `FULL_DAILY_LIMIT` (5). Only `2` reaches that branch in practice, because the precompile rejects any `expectedStatus` outside `{1, 2}` and the call has already reverted. Treating unknown future tiers as Full is intentional so precompile upgrades cannot accidentally lock the contract down.
4. **Rate limit.** A fixed-size ring of the last 5 publish timestamps for that person lives in `_windows[personAlias]`. The check counts entries strictly newer than `block.timestamp - RATE_WINDOW` and reverts with [`RateLimitExceeded(nextAvailableAt)`](../evm/src/interfaces/IPublisher.sol#L42) if the active count is already at the cap for that tier. `nextAvailableAt` is the oldest active timestamp plus `RATE_WINDOW`. That value is the wall-clock when the next slot frees up. On pass, the ring is rotated (oldest dropped) and the current timestamp becomes the new `t0`.

The registry owner skips steps 3 and 4 so it can seed and operate the registry, and may pass an empty `request`.

On success, the publication is recorded (see [Recording semantics](#recording-semantics)) and [`Published(publisher, labelNode, labelhash, timestamp)`](../evm/src/interfaces/IPublisher.sol#L23) is emitted. All three address/bytes32 fields are indexed. `labelNode` is for namehash joins, `labelhash` for label-key joins against dotNS content resolver records. The context alias is deliberately not emitted, see [what the alias must not leak](#what-the-alias-must-not-leak).

### Recording semantics

After the gate, `publish` distinguishes two cases on `_publications[labelhash]`.

- **`indexPlusOne == 0` (new label).** Push the labelhash onto `_published`, write `(publisher, timestamp, indexPlusOne)` into `_publications[labelhash]`.
- **`indexPlusOne != 0` (already live).** Overwrite `publisher` and `timestamp` in place. `indexPlusOne` is unchanged because the array slot stays where it is. This covers both same-publisher republishes (refreshes the timestamp, no other state change) and transfer-then-republish by a new owner (refreshes publisher and timestamp on the existing global entry). Either way the call consumes a rate-limit slot.

The single global feed is intentional. The previous design also maintained a per-publisher list for cheap "show Alice's apps" reads. That was dropped because (a) the duplication tripled storage cost per publish, (b) `browse` reads the global feed via Multicall anyway, and (c) per-publisher filtering on a list capped by daily-publish throughput is trivial client-side.

### Why per-person rate limits, not per-address or per-(sender, label)

An earlier draft considered keying the limit on `(msg.sender, labelhash)` to let multi-app developers publish all their apps without daily friction. That was rejected. `PopRules._priceValidatedName` returns `0` for any tier above `NoStatus`, so Lite users mint labels for gas only. A per-label limit collapses the spam ceiling to "labels owned," which is unbounded for verified users. It also opens a 2-account transfer shuttle. Alice publishes from `alice.dot`, transfers the token to Bob, Bob's `(bob, alice.dot)` slot is fresh and he publishes immediately.

Keying on `msg.sender` alone fails for a related reason once the gate takes a proof. A proof binds to whichever account presents it, so one person can generate a fresh proof for every key they control and each new address would arrive with an untouched window. Keying on the context alias closes that. The alias is fixed per person per context, and [the contract pins the context](#personhood-proof), so a person gets exactly one window no matter how many addresses they publish from.

The cost is friction for legitimate multi-app developers. They trickle out at 1/day (Lite) or 5/day (Full). That trade-off is accepted. The Full tier exists precisely so verified developers feel less of the squeeze.

## Unpublish flow

`unpublish(label)` performs two checks. No personhood gate, no rate-limit read or write.

1. **Non-empty label.** Empty string reverts with [`EmptyLabel`](../evm/src/interfaces/IPublisher.sol#L38).
2. **Ownership.** Same `IDotnsRegistrar.ownerOf` check and same [`NotOwner`](../evm/src/interfaces/IPublisher.sol#L41) error as `publish`.

On success, the entry is removed from `_published` via swap-and-pop and the `_publications[labelhash]` record is deleted. Then [`Unpublished(publisher, labelNode, labelhash, timestamp)`](../evm/src/interfaces/IPublisher.sol#L31) is emitted with `msg.sender` as the publisher field. Calling `unpublish` on a label that was never published succeeds as a no-op against state and emits the event anyway. The live answer is still "not published."

### Why unpublish skips personhood and the rate limit

- **No personhood gate.** A publisher whose verification was revoked still needs to remove their own listings. Self-removal is not a spam vector because the only way to have a listing in the first place was to have passed the publish gate.
- **No rate-limit read or write.** Reading would block a retraction whenever the publisher is at cap, which is wrong UX. Writing would let a Lite user publish, unpublish, then publish again to dodge the daily limit. So `unpublish` leaves the window untouched. It could not find the window anyway, since windows are keyed by alias and `unpublish` takes no proof.

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

Publisher does not store the original label string. Recover it via `IDotnsRegistrar.labelOf(uint256(labelNode))`, where `labelNode = keccak256(abi.encodePacked(tldNode, labelhash))`. The registrar reads from the current owner's `LabelStore` and stays in sync across transfers via `_syncRecipientStore`. Storing the string twice (here and in dotns) would only ever create drift.

The current owner of any label is `IDotnsRegistrar.ownerOf(uint256(labelNode))`. Publisher does not mirror ownership state because it would always be a stale copy. The `publisher` field on the `Publication` record (and the `Published` event) records the caller of the last successful publish. For "who currently controls this label?" always ask the registrar.

For browse, the natural pattern is one paginated `getPublished` call followed by a Multicall3 batch with `publicationOf`, `labelOf`, `contenthash`, `text(node, "name")`, `text(node, "description")`, and (future) manifest records. One batch per ~30-label chunk. To show "apps by Alice," filter the assembled page by `pub.publisher == alice`. No separate on-chain call needed.

### Event path

`Published` and `Unpublished` events carry the same `labelhash` indexed field. An indexer reduces them per `labelhash` and takes the latest by `(blockNumber, logIndex)`. Useful when scanning history or running a light client that can't afford state reads.

## Personhood proof

The gate verifies a proof the caller supplies rather than reading a status the network already holds for them. Nothing has to be bound first, so a publisher who has never registered an alias account can still publish, and the People chain never learns which address the proof was spent from.

The caller fills in a [`ProofVerificationRequest`](../evm/src/interfaces/IPersonhood.sol#L27). Two of its fields are overwritten by [`_verifyPersonhood`](../evm/src/Publisher.sol#L220) before the precompile sees them.

- **`message` becomes [`getPublishDigest(msg.sender, labelhash)`](../evm/src/Publisher.sol#L183).** That is `keccak256(abi.encode(block.chainid, address(this), publisher, labelhash))`. The precompile does not bind the proof to anything itself, so without this the proof is a bearer token. The digest confines it to one publisher, one registry, one chain, and one label, so publishing a second label needs a second proof. Clients must read `getPublishDigest` and generate the proof over exactly those bytes.
- **`context` becomes `PERSONHOOD_CONTEXT`.** The alias is only stable per person within one context, so a caller free to choose the context could mint a fresh alias, and therefore a fresh rate-limit window, on every publish.

Every other field is taken as given. A wrong `expectedAlias`, `ringIndex`, or `revision` just fails verification.

The two overwrites pull in opposite directions and both are load-bearing. Binding the message narrowly is what stops replay. Pinning the context broadly is what stops alias minting. Neither can be relaxed into the other.

### Personhood context

The `PERSONHOOD_CONTEXT` value (`bytes32("dotns")`) reuses dotns' application context so any account already verified for dotns can publish here without a separate ring-root broadcast. That saves the chain-side bootstrap of a `"browse"` ring, and it is the reason the alias must stay off the logs.

### What the alias must not leak

Because the context is shared with dotns, the alias Publisher verifies is the same alias dotns derives for that person. It is a stable per-person pseudonym, so it must never reach a log or a public view.

Writing it to an event would publicly link every address one person publishes from, and link all of them to their dotns identity. The plaintext `publisher` field on `Published` does not do that on its own. An earlier draft emitted a `PublishedByPerson(publisher, personAlias, …)` event to let indexers group publishes by person; it was dropped for exactly this reason. Grouping by person needs a Publisher-specific context, which costs the ring-root broadcast this design chose to avoid.

The alias stays where it is safe: a mapping key, never read back.

## Versioning

`Publisher` inherits [`Semver`](../evm/src/Semver.sol), which stores `(major, minor, patch)` as constructor-set immutables and exposes [`version()`](../evm/src/interfaces/ISemver.sol#L9) returning a stringified `"M.m.p"`. The pattern matches the attestation-protocol convention so any browse contract can be versioned the same way: `contract Foo is IFoo, Semver(M, m, p) { … }`.

The scheme tracks redeployments. The contract itself is immutable, so a "patch" is a new address at the same ABI.

- **MAJOR.** Breaking ABI change (renamed function, changed return type, changed event topic, removed event).
- **MINOR.** Additive change (new function, new event with a new topic, new pure helper).
- **PATCH.** Behaviour fix at the same ABI.

`v3.0.0` is a major bump from `v2.2.0`. `publish` takes a second argument, the personhood proof, so its selector changed. The gate moved from `personhoodStatus(msg.sender, context)` to `personhoodInfoByProof(request)`, the rate-limit ring is now keyed by context alias instead of caller address, and `getPublishDigest` is a new view. A redeploy appends a new address rather than replacing one.

A fresh deployment starts with empty storage, so `v3.0.0` sits **second** in the `PUBLISHER` arrays rather than first. Reads union every entry, writes go to the first, and the published set still lives in the earlier contract. Promoting `v3.0.0` to first is a separate step that needs that state migrated, otherwise writes would land in an empty registry while the feed still reads from the old one. The rate-limit windows do not migrate either: a fresh contract starts every person at an empty window.

`v2.2.0` took the TLD node as a constructor argument instead of hardcoding `.dot`, so one contract serves whichever TLD its network runs.

`v2.0.0` was a major bump from `v1.1.0`. The enumeration views now return raw labelhashes (callers compose with `publicationOf`), `CooldownActive` was replaced by `RateLimitExceeded`, `lastPublishedAt(address)` was removed in favour of the rolling-window ring, and the new `Publication` struct exposes `indexPlusOne` as a public field. Zero means not published, otherwise the value is the 1-indexed position in the global feed.

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
- **Personhood precompile.** Ring roots arrive from the People chain via XCM pub/sub, so they are eventually consistent. A proof against a superseded root stays verifiable until the new root lands, which means a recently-revoked person retains publish ability for the XCM lag window. This is the steady state, not an attack edge.
- **Event log immutability.** Once a `Published` event is in a finalised block, it is in the log forever. An `Unpublished` retraction does not erase the prior payload, only declares the current state. Indexer reducers must take "latest event wins." Any UI that pivots on historical event content (for example cross-referencing old `Published` hashes) inherits the historical payload. This is a fundamental property of event-only registries, not a contract bug.

## Adding a new field

The contract is immutable. A new discovery signal (for example category, locale, modality) goes one of three places.

1. **A new event on a new Publisher deployment** with a bumped MAJOR or MINOR version.
2. **A separate contract** with its own indexable event, joined to Publisher by `labelhash`.
3. **A dotNS text record** on the label's subname, fetched lazily by clients.

Choice depends on whether the signal is required for discovery (event) or for rendering (text record).

## Related

- [Local storage cache](./local-storage.md)
