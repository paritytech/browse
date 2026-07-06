# How Browse ranks the apps it surfaces (v1)

|                 |                                     |
| --------------- | ----------------------------------- |
| **Start Date**  | 2026-07-06                          |
| **Description** | Redesign how new apps are featured  |
| **Authors**     | Tiago Tavares                       |

## Summary

Rank apps by recommend velocity, not a lifetime count. v1 uses only the recommend signal Browse already has.

1. Trending order. Rank by how fast an app is gaining recommends now, not its all-time total.
2. First-publish recency. Show fresh apps before they have any recommends.
3. Editorial fallback. Use a hand-picked order at cold start, when nothing has enough signal to rank.
4. Keep the sticky-order snapshot, and leave saved lists like bookmarks alphabetical.

This is about the score, not the navigation. It adds no tab. Honour and author reputation come later, under Future.

## Motivation

- A lifetime count is stale. It favours old apps and hides what humans like this week.
- It traps new apps. A new app starts at zero and cannot overtake one that banked recommends a year ago.
- It shows no momentum. There is no way to see an app surging now, the signal a store chart exists to give.
- Brigading sticks. A coordinated push to a raw count stays on top, where velocity with decay fades it.

## Status Quo

Browse surfaces apps as one ranked list. [`filterApps`](../app/src/state/apps/types.ts#L56) sorts the published set by `attestationCount` descending, tie-broken by display name. Bookmarks sorts by name only.

```ts
if (mode === 'all' || mode === 'following') {
  return filtered.sort((a, b) => {
    const upvotesA = a.attestationCount ?? 0
    const upvotesB = b.attestationCount ?? 0
    if (upvotesA !== upvotesB) return upvotesB - upvotesA
    return displayName(a).localeCompare(displayName(b))
  })
}
```

`attestationCount` is an all-time total of live recommends, each an on-chain attestation capped at one per dotNS identity by [RecipientAndAttesterIndexResolver.sol](../evm/src/RecipientAndAttesterIndexResolver.sol). The sort ignores when a recommend was cast, so recency is invisible.

[App.tsx:328](../app/src/App.tsx#L328) snapshots the order so positions hold until a membership change ([App.tsx:320](../app/src/App.tsx#L320)) or a `commitOrder` ([App.tsx:450](../app/src/App.tsx#L450)) when a recommend settles. v1 keeps this and changes only the score.

## Design

The scope is the score and the sort, not where the results appear.

### Trending order

Score each app by a time-decayed sum of its recommends.

```
trending(app) = sum over active recommends r of  0.5 ^ ((now - issuedAt_r) / H)
```

`H` is a short half-life. Propose `H = 3 days`. A recommend cast now counts `1`, one cast `H` ago counts `0.5`. A surge lifts an app fast and fades as it ages. A long `H` gives a durable top order from the same formula.

Sort by `trending` descending, then lifetime count, then display name. A revoked or expired recommend counts `0`.

### First-publish recency

Rank apps with no recommends by first publish, newest first, so a fresh app is visible early. Use first publish, not last, so republishing cannot jump back to the top. First publish is the earliest `Published` event per label. See [publishing-registry.md](./publishing-registry.md).

### Editorial fallback

When the catalog is too new to rank, fall back to a hand-picked order the deployer controls. It is a set of labels for cold start, not a new place in the app.

### Anti-gaming

- Decay. A burst fades within days.
- Personhood. One recommend per identity, so a spike cannot come from one account.
- Later, cap the weight per follow-cluster so a coordinated group counts for less than the same number of unconnected humans. This needs the follow graph, so it is deferred.

### Data dependency

Velocity needs the time of each recommend, which the client does not cache. It caches only `attestationCount` ([types.ts:24](../app/src/state/apps/types.ts#L24)). Read the times from the attestation records per app, or from an events index that also feeds first-publish recency. Until then, ship first-publish recency, which needs only the `Published` timestamp, and keep the lifetime count as a stopgap.

## Drawbacks

- Velocity needs per-recommend timestamps or an index, so it is not a drop-in change.
- The half-life needs tuning. Too short churns the list, too long looks like a count.
- A timed burst still spikes velocity for a few days, until decay and the deferred cluster cap catch it.

## Alternatives

- Keep the lifetime count. It is the stale status quo v1 exists to fix.
- Normalize velocity by lifetime count for breakouts. This lets a tiny app with a few recent recommends top everything, which is easy to game. Rejected.
- A Wilson or Bayesian score. It needs up and down votes, which v1 lacks until honour adds a downvote.

## Future

Two additions build on v1 once the pieces exist, both resting on the deployer as the trust root Browse already relies on. The [honour pallet](https://github.com/paritytech/individuality/pull/663) lets a verified human cast plus or minus one on any subject and keeps an on-chain tally, read through a `Score::read` view. Once it is live on the networks Browse targets, fold it into the score for a downvote, so bad apps sink, and a stronger bound, one per verified human against one per identity. The same tally can attach to authors, not just apps: make each app author an honour subject, so a proven author lifts every app they publish instead of each new one starting at zero. The deployer, which already picks the Editorial fallback and holds the trusted-attester key behind the compliance certificate ([TrustedAttesterIndexResolver.sol](../evm/src/TrustedAttesterIndexResolver.sol)), can weight ranking by author honour the way it already vouches through certificates.

## References

- [RecipientAndAttesterIndexResolver.sol](../evm/src/RecipientAndAttesterIndexResolver.sol): one recommend per identity.
- [TrustedAttesterIndexResolver.sol](../evm/src/TrustedAttesterIndexResolver.sol): the deployer trusted-attester root.
- [Publishing Registry v2.0](./publishing-registry.md): the published set and `Published` events.
- [Honour system, individuality#663](https://github.com/paritytech/individuality/pull/663): future honour weighting.
