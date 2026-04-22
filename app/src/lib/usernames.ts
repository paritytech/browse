import { hiddenLog } from './debug'

const API_URL = 'https://polkadot-app.api.polkadotcommunity.foundation/api/v1'

export interface UsernameEntry {
  username: string
  account: string
}

interface ApiUsername {
  candidateAccountId: string
  username: string
  status: string
}

let cachedUsernames: UsernameEntry[] | null = null
let fetchPromise: Promise<UsernameEntry[]> | null = null

/**
 * Fetch all usernames from the People API.
 * Results are cached for the session.
 */
export async function fetchUsernames(): Promise<UsernameEntry[]> {
  if (cachedUsernames) return cachedUsernames
  if (fetchPromise) return fetchPromise

  fetchPromise = doFetch()
  return fetchPromise
}

async function doFetch(): Promise<UsernameEntry[]> {
  const t0 = performance.now()
  hiddenLog(`Fetching usernames: GET ${API_URL}/usernames`)
  try {
    const resp = await fetch(`${API_URL}/usernames`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

    const data = (await resp.json()) as ApiUsername[]
    const usernames: UsernameEntry[] = data
      .filter((u) => u.status === 'ASSIGNED')
      .map((u) => ({ username: u.username, account: u.candidateAccountId }))

    hiddenLog(`Received ${usernames.length} usernames (${(performance.now() - t0).toFixed(0)}ms)`)
    cachedUsernames = usernames
    return usernames
  } catch (err) {
    hiddenLog(`Failed to fetch usernames: ${err}`, 'error')
    fetchPromise = null
    return []
  }
}

/**
 * Search usernames by prefix. Returns up to `limit` matches.
 */
export function searchUsernames(
  usernames: UsernameEntry[],
  query: string,
  limit = 5
): UsernameEntry[] {
  if (!query.trim()) return []
  const q = query.toLowerCase()
  return usernames.filter((u) => u.username.toLowerCase().includes(q)).slice(0, limit)
}

/**
 * Resolve a username to an SS58 account. Returns null if not found.
 */
export function resolveUsername(usernames: UsernameEntry[], username: string): string | null {
  const q = username.toLowerCase()
  const entry = usernames.find((u) => u.username.toLowerCase() === q)
  return entry?.account ?? null
}
