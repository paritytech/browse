export interface LabelEntry {
  label: string
  name: string | null
  description: string
  contentHash: string | null
  attestationCount: number | null
  hasUserAttested: boolean
  fetchedAt?: number
}

export interface AppEntry {
  label: string
  name: string | null
  description: string
  contentHash: string | null
  isLive: boolean
  attestationCount: number | null
  hasUserAttested: boolean
  source: 'pcf' | 'all'
}

export type FilterMode = 'pcf' | 'bookmarks' | 'following' | 'all'

export function displayName(app: AppEntry): string {
  return app.name ?? `${app.label}.dot`
}

export function filterApps(
  apps: AppEntry[],
  query: string,
  mode: FilterMode = 'all',
  bookmarks?: Set<string>,
  followedLabels?: Set<string>
): AppEntry[] {
  const filterByMode: Record<FilterMode, (app: AppEntry) => boolean> = {
    pcf: (app) => app.source === 'pcf',
    all: (app) => app.source === 'all',
    bookmarks: (app) => bookmarks?.has(app.label) ?? false,
    following: (app) => followedLabels?.has(app.label) ?? false
  }
  let filtered = apps.filter(filterByMode[mode])

  // Bookmarks/following match by label only and the source-aware dedup in
  // `App.tsx` keeps both a PCF and an All entry for shared labels — collapse
  // them here so a bookmarked label that exists in both sources shows once.
  if (mode === 'bookmarks' || mode === 'following') {
    const seen = new Set<string>()
    filtered = filtered.filter((app) => {
      if (seen.has(app.label)) return false
      seen.add(app.label)
      return true
    })
  }

  const q = query.toLowerCase().trim()
  if (q) {
    filtered = filtered.filter(
      (app) =>
        app.label.toLowerCase().includes(q) ||
        `${app.label}.dot`.includes(q) ||
        (app.name?.toLowerCase().includes(q) ?? false) ||
        app.description.toLowerCase().includes(q)
    )
  }

  if (mode === 'all') {
    return filtered.sort((a, b) => {
      const ua = a.attestationCount ?? 0
      const ub = b.attestationCount ?? 0
      if (ua !== ub) return ub - ua
      return displayName(a).localeCompare(displayName(b))
    })
  }
  return filtered.sort((a, b) => displayName(a).localeCompare(displayName(b)))
}
