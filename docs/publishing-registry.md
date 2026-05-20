---
summary: "The browse registry: how a .dot label becomes a discoverable app via Personhood-gated, rate-limited Publisher events, with paginated on-chain enumeration"
title: "Publishing Registry v1.1"
read_when:
  - You are adding a publish or unpublish call from the app or a script
  - You are debugging why a label is or is not appearing in browse
  - You are changing the personhood tier rules or cooldown
  - You are indexing `Published` / `Unpublished` events off-chain
  - You are reading the published-app set on-chain or via paginated multicall
  - You need to reason about trust assumptions (registrar upgrade, log immutability, personhood lag)
---

The browse registry is a single contract — [Publisher](../contracts/src/Publisher.sol) — that maintains the canonical set of currently-discoverable `.dot` apps. Calling `publish(label)` adds a label to the set; calling `unpublish(label)` removes it. Content lives elsewhere (dotNS content resolver, store contracts) and is joined off-chain by `labelhash`.

The registry is intentionally minimal: no on-chain content, no admin, no upgrade path. The published set is the only state worth more than the cooldown ledger. Indexers can either read the set directly via paginated `getPublished` calls or follow `Published` / `Unpublished` events; both paths are consensus-canonical.

`Publisher` inherits [`Semver(1, 1, 0)`](../contracts/src/Semver.sol) so `version()` returns `"1.1.0"` — see [versioning](#versioning) below.

## Quick reference

| Symbol | Source | Notes |
|---|---|---|
| `PERSONHOOD_CONTEXT` | [Publisher.sol:20](../contracts/src/Publisher.sol#L20) | `bytes32("dotns")` — reuses the dotns ring root |
| `DOT_NODE` | [Publisher.sol:16](../contracts/src/Publisher.sol#L16) | Precomputed namehash of `.dot` TLD |
| `event Published(publisher, labelNode, labelhash, timestamp)` | [IPublisher.sol:15](../contracts/src/interfaces/IPublisher.sol#L15) | All three address/bytes32 args are `indexed` |
| `event Unpublished(publisher, labelNode, labelhash, timestamp)` | [IPublisher.sol:27](../contracts/src/interfaces/IPublisher.sol#L27) | Same shape as `Published` for symmetric indexer reduce |
| `LITE_COOLDOWN` | [Publisher.sol:23](../contracts/src/Publisher.sol#L23) | 1 day |
| `lastPublishedAt(publisher)` | [Publisher.sol:29](../contracts/src/Publisher.sol#L29) | Per-sender; written by Lite publishes only |
| `PERSONHOOD` precompile | [Publisher.sol:13](../contracts/src/Publisher.sol#L13) | `0x…0a010000`; reads alias-accounts pallet |
| `Publisher.getPublished(offset, limit)` | [Publisher.sol:106](../contracts/src/Publisher.sol#L106) | Paginated read of labelhashes |
| `Publisher.getPublishedAt(index)` | [Publisher.sol:101](../contracts/src/Publisher.sol#L101) | Single labelhash by enumeration index |
| `Publisher.isPublished(labelhash)` | [Publisher.sol:91](../contracts/src/Publisher.sol#L91) | O(1) "is this label live?" predicate |
| `Publisher.publish(label)` | [Publisher.sol:44](../contracts/src/Publisher.sol#L44) | Personhood-gated, rate-limited |
| `Publisher.publishedCount()` | [Publisher.sol:96](../contracts/src/Publisher.sol#L96) | Total live entries |
| `Publisher.registrar()` | [Publisher.sol:26](../contracts/src/Publisher.sol#L26) | The configured `IDotnsRegistrar` |
| `Publisher.unpublish(label)` | [Publisher.sol:70](../contracts/src/Publisher.sol#L70) | Ownership-only; no personhood gate; no cooldown touch |
| `Publisher.version()` | [Semver.sol](../contracts/src/Semver.sol) | Inherited via `Semver(1, 1, 0)` |

## Publish flow

`publish(label)` performs four checks in order. Any failure reverts; no partial state.

1. **Non-empty label.** Empty string reverts with [`EmptyLabel`](../contracts/src/interfaces/IPublisher.sol#L35).
2. **Ownership.** The label's `tokenId` (the `uint256` of `namehash(<label>.dot)`) is queried via [`IDotnsRegistrar.ownerOf`](../contracts/src/interfaces/IDotnsRegistrar.sol#L14). A revert from the registrar (unminted token) and a wrong owner both surface as one error, [`NotOwner`](../contracts/src/interfaces/IPublisher.sol#L37). One error for "doesn't exist" and "exists but not yours" keeps the caller contract simple.
3. **Personhood tier.** [`IPersonhood.personhoodStatus(msg.sender, "dotns")`](../contracts/src/interfaces/IPersonhood.sol#L22) returns a tier:
   - `0` (None) → reverts with [`NoPersonhood`](../contracts/src/interfaces/IPublisher.sol#L36).
   - `1` (Lite) → cooldown check below.
   - `>= 2` (Full and any higher future tier) → unconditional pass. Treating unknown future tiers as Full is intentional so precompile upgrades cannot accidentally lock the contract down.
4. **Cooldown (Lite only).** If `lastPublishedAt[msg.sender] + LITE_COOLDOWN > block.timestamp`, reverts with [`CooldownActive(nextAllowedAt)`](../contracts/src/interfaces/IPublisher.sol#L34). On pass, `lastPublishedAt[msg.sender]` is updated. Full-tier publishes skip the write so the mapping truthfully reads "last publish subject to cooldown" rather than "last publish ever."

On success, the labelhash is inserted into the published list (idempotent — republish is a no-op against state) and [`Published(publisher, labelNode, labelhash, timestamp)`](../contracts/src/interfaces/IPublisher.sol#L15) is emitted. All three address/bytes32 fields are indexed — `labelNode` for namehash joins, `labelhash` for label-key joins against dotNS content resolver records.

### Why per-sender cooldown, not per-(sender, label)

An earlier draft keyed the cooldown on `(msg.sender, labelhash)` to let multi-app developers publish all their apps without a 24h drip. That was rejected: `PopRules._priceValidatedName` returns `0` for any tier above `NoStatus`, so Lite users mint labels for gas only. A per-label cooldown collapses the spam ceiling to "labels owned," which is unbounded for verified users. It also opens a 2-account transfer shuttle: Alice publishes from `alice.dot`, transfers the token to Bob, Bob's slot for `alice.dot` is fresh and he publishes immediately. Per-sender cooldown denies both attacks. The cost is friction for legitimate multi-app developers — they trickle out at 1/day. That trade-off is accepted.

## Unpublish flow

`unpublish(label)` performs two checks. No personhood gate, no cooldown read or write.

1. **Non-empty label.** Empty string reverts with [`EmptyLabel`](../contracts/src/interfaces/IPublisher.sol#L35).
2. **Ownership.** Same `IDotnsRegistrar.ownerOf` check and same [`NotOwner`](../contracts/src/interfaces/IPublisher.sol#L37) error as `publish`.

On success, the labelhash is removed from the published list via swap-and-pop (idempotent — unpublishing a never-published label is a no-op against state) and [`Unpublished(publisher, labelNode, labelhash, timestamp)`](../contracts/src/interfaces/IPublisher.sol#L27) is emitted. Calling `unpublish` on a label that was never published succeeds as a no-op against state and emits the event anyway — the live answer is still "not published."

### Why unpublish skips personhood and cooldown

- **No personhood gate.** A publisher whose verification was revoked still needs to remove their own listings. Self-removal is not a spam vector because the only way to have a listing in the first place was to have passed the publish gate.
- **No cooldown read or write.** Reading the cooldown would block a retraction whenever the publisher is mid-window — wrong UX. Writing it would let a Lite user `publish → unpublish → publish` to dodge the 24h rate limit. So `unpublish` leaves `lastPublishedAt[msg.sender]` untouched.

Republishing a previously unpublished label goes through the normal `publish` flow with the normal cooldown.

## Reading the published set

Two paths, both consensus-canonical:

### State path (preferred for browse)

```solidity
uint256 total = publisher.publishedCount();
bytes32[] memory page = publisher.getPublished(0, 1000);
```

`getPublished(offset, limit)` returns labelhashes in insertion order. Removes use swap-and-pop (a 1-indexed position map keeps removes O(1)), so **enumeration order is not stable across unpublishes** — a label removed mid-page swaps the tail into its slot. Clients that need a consistent snapshot should page within one block, or reduce by `labelhash` and treat the result as a set.

Publisher does not store the original label string. Recover it via `IDotnsRegistrar.labelOf(uint256(labelNode))`, where `labelNode = keccak256(abi.encodePacked(DOT_NODE, labelhash))`. The registrar reads from the current owner's `LabelStore` and stays in sync across transfers via `_syncRecipientStore`. Storing the string twice (here and in dotns) would only ever create drift.

The current owner of any entry is `IDotnsRegistrar.ownerOf(uint256(labelNode))` — Publisher does not mirror ownership state because it would always be a stale copy. The `publisher` field in the `Published` event records the caller of the last successful publish; for "who currently controls this label?" always ask the registrar.

For browse, the natural pattern is one paginated `getPublished` call followed by a Multicall3 batch with `labelOf`, `contenthash`, `text(node, "name")`, `text(node, "description")`, and (future) manifest records — one batch per ~30-label chunk.

### Event path

`Published` / `Unpublished` events carry the same `labelhash` indexed field; an indexer reduces them per `labelhash` and takes the latest by `(blockNumber, logIndex)`. Useful when scanning history, building a separate index, or running a light client that can't afford state reads.

## Personhood context

The `PERSONHOOD_CONTEXT` value (`bytes32("dotns")`) reuses dotns' application context so any account already verified for dotns can publish here without a separate ring-root broadcast. Publisher emits `publisher` in plain text in the `Published` event, so the per-context aliasing's anti-linkability benefit is unused — collapsing onto dotns' context costs nothing observable on the read side and saves the chain-side bootstrap of a `"browse"` ring.

## Versioning

`Publisher` inherits [`Semver`](../contracts/src/Semver.sol), which stores `(major, minor, patch)` as constructor-set immutables and exposes [`version()`](../contracts/src/interfaces/ISemver.sol#L9) returning a stringified `"M.m.p"`. The pattern matches the attestation-protocol convention so any browse contract can be versioned the same way: `contract Foo is IFoo, Semver(M, m, p) { … }`.

The scheme tracks redeployments — the contract itself is immutable, so a "patch" is a new address at the same ABI:

- **MAJOR** — breaking ABI change (renamed function, changed event topic, removed event).
- **MINOR** — additive change (new function, new event with a new topic, new pure helper).
- **PATCH** — behaviour fix at the same ABI.

The current pre-deployment iteration is tagged `v1.1.0`; once the contract is deployed, future changes follow the rules above.

## What is not on-chain

- **App metadata.** Display name, icon, description, executables — all in dotNS text records (see [Product Manifest RFC](https://github.com/paritytech/triangle-js-sdks/pull/174)) and Bulletin chain CIDs.
- **Categories, ranking, social signals.** Client-side concerns; see [local-storage.md](./local-storage.md) for the cache layout.
- **Content hashes.** Deliberately not in `Published` or in Publisher state. Content lives on the dotNS content resolver; embedding a hash here would create two sources of truth and bake event semantics into the contract forever.
- **The original label string.** `IDotnsRegistrar.labelOf(tokenId)` is the canonical source; Publisher only stores the labelhash.
- **The current label owner.** `IDotnsRegistrar.ownerOf(tokenId)` is the live answer; mirroring it on Publisher would only ever be a stale copy.

## Trust assumptions

The contract has no admin, no upgrade, and no privileged callers. The only external trust roots are:

- **DotNS registrar.** `IDotnsRegistrar` is `immutable` in this contract, but the dotNS registrar implementation is an OpenZeppelin upgradeable proxy. A compromised dotNS governance can rewrite `ownerOf` to spoof ownership, which Publisher would honor blindly. The blast radius is total; the mitigation is not in this contract.
- **Personhood precompile.** The alias-accounts pallet receives ring roots from the People chain via XCM pub/sub. Status updates are eventually consistent — a recently-revoked verification retains publish ability for the XCM lag window. This is the steady state, not an attack edge.
- **Event log immutability.** Once a `Published` event is in a finalised block, it is in the log forever. An `Unpublished` retraction does not erase the prior payload, only declares the current state. Indexer reducers must take "latest event wins"; any UI that pivots on historical event content (e.g. cross-referencing old `Published` hashes) inherits the historical payload. This is a fundamental property of event-only registries, not a contract bug.

## Adding a new field

The contract is immutable. A new discovery signal (e.g. category, locale, modality) goes one of three places:

1. **A new event on a new Publisher deployment** with a bumped MAJOR or MINOR version.
2. **A separate contract** with its own indexable event, joined to Publisher by `labelhash`.
3. **A dotNS text record** on the label's subname, fetched lazily by clients.

Choice depends on whether the signal is required for discovery (event) or for rendering (text record).

## Related

- [Local storage cache](./local-storage.md)
