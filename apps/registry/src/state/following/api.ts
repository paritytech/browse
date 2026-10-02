import { localStorage } from '../../lib/local-storage'

const KEY = 'browse:following'

export interface FollowedAccount {
  address: string
  username?: string
}

function parseFollowing(data: unknown): FollowedAccount[] {
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
}

export async function getFollowing(): Promise<FollowedAccount[]> {
  try {
    return parseFollowing(await localStorage.readJSON<unknown[]>(KEY))
  } catch {
    return []
  }
}

/**
 * The accounts the user follows, retrying a store that will not answer.
 *
 * An empty list is what the Following tab renders, so a read that failed would
 * look like a user who follows nobody.
 */
export async function getFollowingWithRetry(attempts = 5): Promise<FollowedAccount[]> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return parseFollowing(await localStorage.readJSONOrThrow<unknown[]>(KEY))
    } catch (err) {
      if (attempt === attempts) throw err
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
    }
  }
  return []
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
