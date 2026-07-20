/**
 * Local record of apps the user was sent to via a share link, so browse can ask
 * them to recommend it on a later visit — once they've actually had a chance to
 * try it. Stored in localStorage (synchronous) so the seed survives the
 * immediate redirect into the app.
 */

const KEY = 'browse.pendingRecommend'
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface PendingRecommend {
  label: string
  from?: string
  seenAt: number
}

function read(): Record<string, PendingRecommend> {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, PendingRecommend>) : {}
  } catch {
    return {}
  }
}

function write(map: Record<string, PendingRecommend>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // Storage unavailable or full — a missed nudge is not worth throwing over.
  }
}

/** Record that the user was sent to `label` from a share link, to prompt later. */
export function addPendingRecommend(label: string, from?: string): void {
  const map = read()
  map[label] = { label, from, seenAt: Date.now() }
  write(map)
}

/** Non-expired pending records, newest first. Prunes expired entries on read. */
export function readPendingRecommends(): PendingRecommend[] {
  const map = read()
  const now = Date.now()
  const live = Object.values(map).filter((entry) => now - entry.seenAt < EXPIRY_MS)
  if (live.length !== Object.keys(map).length) {
    write(Object.fromEntries(live.map((entry) => [entry.label, entry])))
  }
  return live.sort((a, b) => b.seenAt - a.seenAt)
}

/** Drop a pending record once the user has answered its prompt (or recommended). */
export function clearPendingRecommend(label: string): void {
  const map = read()
  if (map[label]) {
    delete map[label]
    write(map)
  }
}
