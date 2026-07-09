import { ensurePeopleApi } from './client'

export interface UsernameEntry {
  username: string
  account: string
}

// A People-chain lookup normally completes in <1 s. Any longer means the WS is
// flapping (WKWebView "network connection was lost" tight-loop) and the RPC is
// wedged behind an unstable socket. Fail fast so the caller can surface an
// empty-result state instead of leaving the modal hung for minutes.
const LOOKUP_TIMEOUT_MS = 5_000

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
  try {
    const owner = await withTimeout(
      api.query.Resources.UsernameOwnerOf.getValue(key),
      LOOKUP_TIMEOUT_MS,
      `UsernameOwnerOf(${username})`
    )
    console.warn(
      'debug network connection',
      JSON.stringify({ event: 'searchUsernames:returned', owner: owner ?? null })
    )
    if (!owner) return []
    return [{ username, account: owner }]
  } catch (err) {
    console.warn(
      'debug network connection',
      JSON.stringify({ event: 'searchUsernames:timeout', reason: String(err) })
    )
    throw err
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`RPC timeout after ${ms}ms: ${label}`)), ms)
    promise.then(
      (value) => {
        clearTimeout(id)
        resolve(value)
      },
      (err) => {
        clearTimeout(id)
        reject(err)
      }
    )
  })
}
