import { localStorage } from '../../lib/local-storage'

const KEY = 'browse:following'

export interface FollowedAccount {
  address: string
  username?: string
}

export async function getFollowing(): Promise<FollowedAccount[]> {
  try {
    const data = await localStorage.readJSON<unknown[]>(KEY)
    if (!Array.isArray(data)) return []
    return data
      .map((item: unknown): FollowedAccount | null => {
        if (typeof item === 'string') return { address: item }
        if (item && typeof item === 'object' && 'address' in item) {
          const record = item as { address: unknown; username?: unknown }
          const username = typeof record.username === 'string' ? record.username : undefined
          return { address: String(record.address), username }
        }
        return null
      })
      .filter((entry): entry is FollowedAccount => entry !== null)
  } catch {
    return []
  }
}

export async function follow(address: string, username?: string): Promise<void> {
  const following = await getFollowing()
  if (!following.some((account) => account.address === address)) {
    following.push({ address, username })
    await localStorage.writeJSON(KEY, following)
  }
}

export async function unfollow(address: string): Promise<void> {
  const following = await getFollowing()
  await localStorage.writeJSON(
    KEY,
    following.filter((account) => account.address !== address)
  )
}
