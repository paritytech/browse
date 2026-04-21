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

  return filtered.sort((a, b) => displayName(a).localeCompare(displayName(b)))
}
