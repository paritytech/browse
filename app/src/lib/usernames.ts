import { ensurePeopleApi } from './client'

export interface UsernameEntry {
  username: string
  account: string
}

// Usernames live in the People chain DotNS `Resources.UsernameOwnerOf` map,
// which maps username bytes to an owner SS58 address. The map is keyed by the
// full username, so, like the main search query resolving an exact label, we
// look up exactly what the user typed. One storage read, no enumeration.
export async function searchUsernames(query: string): Promise<UsernameEntry[]> {
  const username = query.trim().toLowerCase()
  console.warn(
    'debug network connection',
    JSON.stringify({ event: 'searchUsernames:start', query, username })
  )
  if (!username) return []
  const key = new TextEncoder().encode(username)
  const api = await ensurePeopleApi()
  console.warn('debug network connection', JSON.stringify({ event: 'searchUsernames:querying' }))
  const owner = await api.query.Resources.UsernameOwnerOf.getValue(key)
  console.warn(
    'debug network connection',
    JSON.stringify({ event: 'searchUsernames:returned', owner: owner ?? null })
  )
  if (!owner) return []
  return [{ username, account: owner }]
}
