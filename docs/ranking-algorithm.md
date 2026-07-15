# Browse ranking algorithm

|                 |                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------- |
| **Start Date**  | 2026-07-15                                                                                   |
| **Description** | A composite app-ranking score: recency-weighted recommends, with freshness, certification, and completeness modifiers |
| **Authors**     | Tiago Tavares                                                                                |

## Summary

Rank apps by a recency-weighted recommend score, then apply multiplicative modifiers: a strong decaying freshness boost, a strong certification boost, and a gentle completeness penalty. This is the concrete scoring spec. The objective is to surface what verified humans value now, give new and maintained apps a fair shot, and resist gaming by construction.

## Motivation

Browse ranks its one list by a lifetime recommend count today, which is stale and traps new apps at the bottom. This spec replaces that with a composite score: demand velocity as the lever, plus a strong but decaying freshness boost, a strong certification boost, and a gentle completeness penalty. Every marketplace studied ranks on recent velocity and treats reviews or trust as a nudge, not the primary rank, so the shape here follows proven prior art.

## Stakeholders

- The browse client, which computes the score and renders the order.
- Developers, who want a new or freshly-updated app to be findable.
- Verified humans, whose recommends drive the demand signal.
- The deployer, which configures the trusted certificate authorities and the Editorial fallback.

## Explanation

### Score

```
score(app) = Demand(app) * Freshness(app) * Trust(app) * Quality(app)
```

The form is multiplicative so it is scale-free and easy to tune, and every modifier stays gentle so Demand remains the lever. Tie-break by lifetime recommend count descending, then display name.

### Demand

```
Demand(app) = demandPrior + sum over active recommends of  0.5 ^ (recommendAge / recommendHalfLife)
```

The recency-weighted count of recommends, which is the demand velocity. `recommendAge` is how long ago a recommend was cast, so one cast now counts `1` and one cast `recommendHalfLife` ago counts `0.5`. Propose `recommendHalfLife = 14 days` for the main order, and `3 days` for an explicit trending view. `demandPrior = 1` keeps a zero-recommend app from being annihilated, so the other terms can still lift it. A recommend is an attestation capped at one per identity by [RecipientAndAttesterIndexResolver.sol](../evm/src/RecipientAndAttesterIndexResolver.sol). A revoked or expired recommend counts `0`.

### Freshness

```
Freshness(app) = 1 + newBoost    * 0.5 ^ (ageSincePublish / newHalfLife)
                   + updateBoost * 0.5 ^ (ageSinceUpdate  / updateHalfLife)
```

A lift for new and recently-updated apps that decays back to `1`. `ageSincePublish` is the time since the earliest `Published` event for the label. `ageSinceUpdate` is the time since the last real content change, meaning the `contentHash` changed and not a republish that only refreshes the timestamp. Propose `newBoost = 1.0, newHalfLife = 14 days` for the launch window, and `updateBoost = 0.5, updateHalfLife = 14 days` for genuine updates. Freshness is the strongest modifier by design: a brand-new app can be lifted up to `2.5x`, so it gets a real, decaying head start rather than a token nudge, which is how a new app escapes the cold-start trap.

The client ships the `newBoost` term only. It reads `ageSincePublish` from `Publisher.publicationOf(labelhash).timestamp`, a view call with no index needed. That value is the last publish, so it equals first publish for an app never republished, and a republish refreshes it. The `updateBoost` term is not applied yet: it needs the dotNS content-hash change time, which is not a view (see [paritytech/dotns#193](https://github.com/paritytech/dotns/issues/193)).

### Trust

```
Trust(app) = certified ? 2.0 : 1.0
```

A strong boost for a certified app, though not a gate, because publishing is permissionless. `certified` means the app holds at least one active certificate from a trusted authority, the `certificates` field on the app. The same flag also filters a curated Featured lane.

### Quality

```
Quality(app) = (hasIcon and hasDescription and isLive) ? 1.0 : 0.6
```

A completeness check that pushes broken or empty listings down without hiding them. All three come from the app entry ([types.ts:17](../app/src/state/apps/types.ts#L17)): an icon, a description, and `isLive`, which is true when `contentHash` is set.

### Why multiplicative, and how the modifiers are weighted

Demand is the lever. Freshness (up to about `2.5x`) and Trust (`2.0x` when certified) are deliberate strong boosts, so a new or a certified app gets a real chance to be seen rather than a token nudge. Only Quality stays a gentle penalty, `0.6`, for an incomplete listing. A genuinely popular app, with many recommends, still tops the list because Demand dwarfs the modifiers once the count is high, but a certified or brand-new app can now outrank a lightly-recommended one. The `demandPrior` is what lets Freshness and Trust surface a brand-new app that has no recommends yet.

### Last update is a boost, not a penalty

Do not decay an old but loved app. Its Demand carries it. Reward a genuine update through the Freshness term, and ignore an empty republish, which changes the timestamp but not the `contentHash`.

### Cold start

When the whole catalog has near-zero Demand, the Freshness and Trust terms dominate on their own, and a hand-picked Editorial order overrides the score until there is real signal.

## Drawbacks

- The half-life and the modifier weights are tuning parameters. Wrong values make the list either jittery or stagnant.
- Demand velocity needs per-recommend timestamps or an events index, so it is not a drop-in change to the current sort.
- A timed burst still spikes Demand for a few days until the decay and the deferred cluster cap catch it.
- A composite is harder to explain to a developer than a plain count.

## Testing, Security, and Privacy

Anti-gaming is mostly a property of the inputs, not a heuristic layer:

- Decay. A burst fades within days through the `recommendHalfLife`.
- Personhood. One recommend per identity on-chain, so a spike cannot come from one account.
- Trust. The certificate boost rides the configured certificate authorities, not open input.
- Later, weight each recommend by the caster honour, and cap the contribution per follow-cluster, so a coordinated group counts for less than the same number of unconnected humans. See [individuality#663](https://github.com/paritytech/individuality/pull/663).

On privacy, all inputs are already public: recommends are attributed on-chain attestations and the certificate is a public attestation. The score reads nothing private.

The invariants worth testing are that the score is monotonic in fresh recommends, that the decay matches the half-life, that a zero-recommend but certified or fresh app still surfaces through the `demandPrior`, and that the Editorial fallback takes over when Demand is near zero across the catalog.

## Performance, Ergonomics, and Compatibility

### Performance

The score is a per-app reduction over its active recommends plus three cheap modifier lookups. The heavy cost is reading per-recommend timestamps, which is why the interim score below avoids them.

### Compatibility

The change is to the comparison only. It reuses the existing sticky-order snapshot, so cards do not reshuffle as scores drift: recompute only on a membership change or a `commitOrder` when a recommend settles ([App.tsx:450](../app/src/App.tsx#L450)).

### What ships now, and what needs the index

- Live now: Demand as the lifetime recommend count, Trust from `certificates`, Quality from `iconCid`/`description`/`isLive`, and the Freshness launch boost from `Publisher.publicationOf(labelhash).timestamp`, a view call needing no index.
- Deferred, needing new reads or an events index: true recommend velocity for Demand (per-recommend timestamps), the first-publish window as distinct from last publish (the `Published` event history), and the `ageSinceUpdate` term (the dotNS content-hash change time, see [paritytech/dotns#193](https://github.com/paritytech/dotns/issues/193)).

## Prior Art and References

The composite follows patterns proven across app and content marketplaces: the App Store and Google Play rank charts on recent install velocity rather than lifetime totals, Product Hunt ranks by weighted votes with time decay, and Steam shows a recent-30-day review score beside the all-time one so the divergence flags a decline. Reviews and trust act as a gate or a nudge everywhere, not as the primary rank, which is why the modifiers here stay small.

- [`filterApps`](../app/src/state/apps/types.ts#L56): where the sort lives today.
- [types.ts:17](../app/src/state/apps/types.ts#L17): the app entry fields the score reads.
- [RecipientAndAttesterIndexResolver.sol](../evm/src/RecipientAndAttesterIndexResolver.sol): one recommend per identity.
- [certificate-authorities/types.ts](../app/src/state/certificate-authorities/types.ts): the trusted certificate authorities the badge and Trust boost read.

## Unresolved Questions

- The constants (`recommendHalfLife`, `demandPrior`, `newBoost`, `newHalfLife`, `updateBoost`, `updateHalfLife`, and the modifier caps) need tuning from real data.
- Whether to blend one order or run a separate short-half-life trending view beside the main order.
- The exact per-follow-cluster cap, which needs the follow graph and its own design.

## Future Directions and Related Material

Once the [honour pallet](https://github.com/paritytech/individuality/pull/663) is live on the networks Browse targets, honour becomes a per-recommend credibility weight inside Demand and a downvote that can pull a bad app down, not just fail to lift it. The per-cluster cap and a broader certificate-gated Featured lane build on the same inputs.
