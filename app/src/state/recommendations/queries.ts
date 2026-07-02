import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type SS58String } from 'polkadot-api'

import { getCachedFollowed, setCachedFollowed } from './cache'
import { namehash, nodeToSubject } from '../../lib/abi'
import { attestationService } from '../../lib/attestation-service'
import { resolveIdentityH160 } from '../apps/identity'
import { type AppEntry } from '../apps/types'

const PAGE_SIZE = 100n
const PAGE_SIZE_NUM = Number(PAGE_SIZE)

async function listRecipientAttestations(recipient: `0x${string}`): Promise<bigint[]> {
  const count = await attestationService.countByRecipientAndSchema(recipient)
  if (count === 0n) return []

  const ids: bigint[] = []
  for (let offset = 0n; offset < count; offset += PAGE_SIZE) {
    const remaining = count - offset
    const limit = remaining < PAGE_SIZE ? remaining : PAGE_SIZE
    ids.push(...(await attestationService.listByRecipientAndSchema(recipient, offset, limit)))
  }
  return ids
}

/**
 * Map each label to the subset of `identityH160s` that recommended it. Labels
 * with no matching recommender are omitted.
 *
 * A recommendation on-chain attester is a product account bound to an identity.
 * We enumerate the live attestations for each app and match the *current* bound
 * identity of each attester against `identityH160s`. This captures every
 * recommendation an identity made, across its product accounts and across
 * resolver versions, including legacy resolvers with no identity index.
 */
async function mapRecommendersByLabel(
  labels: string[],
  identityH160s: string[]
): Promise<Map<string, Set<string>>> {
  const byLabel = new Map<string, Set<string>>()
  if (labels.length === 0 || identityH160s.length === 0) return byLabel

  const wanted = new Set(identityH160s.map((h) => h.toLowerCase()))
  const now = BigInt(Math.floor(Date.now() / 1000))
  const identityH160ByAttester = new Map<string, string>()

  await Promise.all(
    labels.map(async (label) => {
      const recipient = nodeToSubject(namehash(`${label}.dot`)) as `0x${string}`
      const ids = await listRecipientAttestations(recipient)
      if (ids.length === 0) return

      const matched = new Set<string>()
      for (let i = 0; i < ids.length; i += PAGE_SIZE_NUM) {
        const records = await attestationService.getAttestationByIds(
          ids.slice(i, i + PAGE_SIZE_NUM)
        )
        for (const record of records) {
          if (record.revocationTime !== 0n) continue
          if (record.expirationTime !== 0n && record.expirationTime <= now) continue

          const attester = record.attester.toLowerCase()
          let identityH160 = identityH160ByAttester.get(attester)
          if (identityH160 === undefined) {
            identityH160 = (await attestationService.identityOf(record.attester)).toLowerCase()
            identityH160ByAttester.set(attester, identityH160)
          }
          if (wanted.has(identityH160)) matched.add(identityH160)
        }
      }
      if (matched.size > 0) byLabel.set(label, matched)
    })
  )

  return byLabel
}

async function getAppsRecommendedByIdentities(
  labels: string[],
  identityH160s: string[]
): Promise<Set<string>> {
  return new Set((await mapRecommendersByLabel(labels, identityH160s)).keys())
}

async function getFollowedApps(
  apps: AppEntry[],
  followingAddresses: string[]
): Promise<Set<string>> {
  if (followingAddresses.length === 0) return new Set()

  // A followed SS58 is the *identity* (bound) account. Map it to its identity
  // H160 the way the resolver derives it, then match apps by that identity.
  const identityH160s = followingAddresses.map(
    (ss58) => ss58ToEthereum(ss58 as SS58String) as string
  )
  return getAppsRecommendedByIdentities(
    apps.map((app) => app.label),
    identityH160s
  )
}

/** The apps at least one followed account has recommended, for the Following tab. */
export function useGetAttestationsByFollowing(apps: AppEntry[], followingAddresses: string[]) {
  const sorted = [...followingAddresses].sort()

  return useQuery<Set<string>>({
    queryKey: ['attestations', 'following', sorted],
    queryFn: async () => {
      const result = await getFollowedApps(apps, followingAddresses)
      setCachedFollowed([...result])
      return result
    },
    // Run even with nobody followed, which returns an empty set immediately.
    // Unfollowing the last account must resolve to empty so the caller can fade
    // its cards out, rather than leaving the query disabled on stale data.
    enabled: apps.length > 0,
    // Keep the last resolved set on screen while the following set refetches, so
    // unfollowing never blanks the tab into skeletons. The caller fades the
    // dropped apps out once the new set resolves.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000
  })
}

/**
 * The published apps the current user identity has recommended.
 *
 * Uses the same attester-to-identity enumeration as the Following query, so the
 * recommend button matches the Following list no matter which product account
 * signed a recommendation or which resolver version recorded it. The attest and
 * revoke mutations keep this set fresh optimistically, so it never lags the
 * toggle.
 */
export function useGetMyRecommendations(apps: AppEntry[]) {
  const labels = [...apps.map((app) => app.label)].sort()
  return useQuery<Set<string>>({
    queryKey: ['attestations', 'mine', labels],
    queryFn: async () => {
      const identityH160 = await resolveIdentityH160()
      if (!identityH160) return new Set<string>()
      return getAppsRecommendedByIdentities(labels, [identityH160])
    },
    enabled: apps.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000
  })
}

export async function prefetchFollowedLabels(
  queryClient: import('@tanstack/react-query').QueryClient
) {
  const cached = await getCachedFollowed()
  if (cached.length > 0) {
    // updatedAt: 0 marks the cached data as stale so useQuery will trigger a
    // background refetch when a subscriber mounts.
    queryClient.setQueryData(['attestations', 'followed'], new Set(cached), { updatedAt: 0 })
  }
}
