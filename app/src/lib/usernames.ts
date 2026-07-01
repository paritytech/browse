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
  if (!username) return []
  const key = new TextEncoder().encode(username)
  const api = await ensurePeopleApi()
  const owner = await api.query.Resources.UsernameOwnerOf.getValue(key)
  if (!owner) return []
  return [{ username, account: owner }]
}
