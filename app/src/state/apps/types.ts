export interface AppEntry {
  label: string
  name: string | null
  description: string
  iconCid: string | null
  contentHash: string | null
  isLive: boolean
  attestationCount: number | null
  hasUserAttested: boolean
  /** Holds an active compliance attestation from the trusted attester. */
  isCompliant: boolean
}

export const FILTER_MODES = ['all', 'bookmarks', 'following'] as const
export type FilterMode = (typeof FILTER_MODES)[number]

export function isFilterMode(value: string): value is FilterMode {
  return (FILTER_MODES as readonly string[]).includes(value)
}

export function displayName(app: AppEntry): string {
  return app.name ?? `${app.label}.dot`
}

export function filterApps(
  apps: AppEntry[],
  query: string,
  mode: FilterMode = 'all',
  bookmarkedApps?: Set<string>,
  followingApps?: Set<string>,
  publishedApps?: Set<string>
): AppEntry[] {
  const filterByMode: Record<FilterMode, (app: AppEntry) => boolean> = {
    all: (app) => publishedApps?.has(app.label) ?? true,
    bookmarks: (app) => bookmarkedApps?.has(app.label) ?? false,
    following: (app) => followingApps?.has(app.label) ?? false
  }
  let filtered = apps.filter(filterByMode[mode])

  const needle = query.toLowerCase().trim()
  if (needle) {
    filtered = filtered.filter(
      (app) =>
        app.label.toLowerCase().includes(needle) ||
        `${app.label}.dot`.includes(needle) ||
        (app.name?.toLowerCase().includes(needle) ?? false) ||
        app.description.toLowerCase().includes(needle)
    )
  }

  if (mode === 'all') {
    return filtered.sort((a, b) => {
      const upvotesA = a.attestationCount ?? 0
      const upvotesB = b.attestationCount ?? 0
      if (upvotesA !== upvotesB) return upvotesB - upvotesA
      return displayName(a).localeCompare(displayName(b))
    })
  }
  return filtered.sort((a, b) => displayName(a).localeCompare(displayName(b)))
}
