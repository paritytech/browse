import { ss58ToEthereum } from '@polkadot-api/sdk-ink'
import { useQuery } from '@tanstack/react-query'
import { AccountId, type SS58String } from 'polkadot-api'

import { getCachedFollowed, setCachedFollowed } from './cache'
import { namehash, nodeToSubject } from '../../lib/abi'
import { attestationService } from '../../lib/attestation-service'
import { SCHEMA_LIKE_ID } from '../../lib/config'
import { type AppEntry } from '../apps/types'

const PAGE_SIZE = 100n
const PAGE_SIZE_NUM = Number(PAGE_SIZE)

async function listAllAttestationsByAttester(attester: `0x${string}`): Promise<bigint[]> {
  const count = await attestationService.countByAttester(attester)
  if (count === 0n) return []

  const ids: bigint[] = []
  for (let offset = 0n; offset < count; offset += PAGE_SIZE) {
    const remaining = count - offset
    const limit = remaining < PAGE_SIZE ? remaining : PAGE_SIZE
    const page = await attestationService.listByAttester(attester, offset, limit)
    ids.push(...page)
  }
  return ids
}

async function getFollowedApps(apps: AppEntry[], contacts: string[]): Promise<Set<string>> {
  if (contacts.length === 0 || apps.length === 0) return new Set()

  const h160Contacts = contacts.map(
    (ss58) => ss58ToEthereum(ss58 as SS58String).asHex() as `0x${string}`
  )

  const recipientToLabel = new Map<string, string>()
  for (const app of apps) {
    const recipient = nodeToSubject(namehash(`${app.label}.dot`)).toLowerCase()
    recipientToLabel.set(recipient, app.label)
  }

  const idsPerAttester = await Promise.all(h160Contacts.map(listAllAttestationsByAttester))
  const allIds = idsPerAttester.flat()
  if (allIds.length === 0) return new Set()

  const now = BigInt(Math.floor(Date.now() / 1000))
  const followed = new Set<string>()

  for (let i = 0; i < allIds.length; i += PAGE_SIZE_NUM) {
    const batch = allIds.slice(i, i + PAGE_SIZE_NUM)
    const records = await attestationService.getAttestationByIds(batch)
    for (const r of records) {
      if (r.schema !== SCHEMA_LIKE_ID) continue
      if (r.revocationTime !== 0n) continue
      if (r.expirationTime !== 0n && r.expirationTime <= now) continue
      const label = recipientToLabel.get(r.recipient.toLowerCase())
      if (label) followed.add(label)
    }
  }

  return followed
}

export function useGetAttestationsByContacts(apps: AppEntry[], contactAddresses: string[]) {
  const sorted = [...contactAddresses].sort()

  return useQuery<Set<string>>({
    queryKey: ['attestations', 'followed', sorted],
    queryFn: async () => {
      const result = await getFollowedApps(apps, contactAddresses)
      setCachedFollowed([...result])
      return result
    },
    enabled: contactAddresses.length > 0 && apps.length > 0,
    staleTime: 5 * 60_000
  })
}

export function useGetAppAttestation(label: string) {
  return useQuery({
    queryKey: ['attestations', 'app', label],
    queryFn: async () => {
      const recipient = nodeToSubject(namehash(`${label}.dot`))
      const { publicKey } = await attestationService.getSigner()
      const ss58 = AccountId().dec(publicKey)
      const userH160 = ss58ToEthereum(ss58 as SS58String).asHex()
      const [count, hasUserAttested] = await Promise.all([
        attestationService.countByRecipientAndSchema(recipient, SCHEMA_LIKE_ID),
        attestationService.isActiveAny(recipient, SCHEMA_LIKE_ID, [userH160])
      ])
      return { attestationCount: Number(count), hasUserAttested }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
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
