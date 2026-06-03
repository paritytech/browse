// Identity backend for username search/resolution.
const API_URL =
  import.meta.env.VITE_IDENTITY_API_URL ??
  'https://identity-backend-next.parity-testnet.parity.io/api/v1'

export interface UsernameEntry {
  username: string
  account: string
}

interface ApiUsername {
  candidateAccountId: string
  username: string
  status: string
}

async function fetchByPrefix(prefix: string): Promise<UsernameEntry[]> {
  const url = `${API_URL}/usernames?prefix=${encodeURIComponent(prefix)}&status=ASSIGNED`
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = (await resp.json()) as ApiUsername[]
    return data.map((entry) => ({ username: entry.username, account: entry.candidateAccountId }))
  } catch {
    return []
  }
}

/** Server-side prefix search. Returns up to `limit` matches. */
export async function searchUsernames(query: string, limit = 5): Promise<UsernameEntry[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []
  const results = await fetchByPrefix(trimmedQuery)
  return results.slice(0, limit)
}

/** Resolve a full username to its SS58 account via prefix lookup. */
export async function resolveUsername(username: string): Promise<string | null> {
  const trimmedUsername = username.trim()
  if (!trimmedUsername) return null
  const results = await fetchByPrefix(trimmedUsername)
  const lowercased = trimmedUsername.toLowerCase()
  return results.find((entry) => entry.username.toLowerCase() === lowercased)?.account ?? null
}
