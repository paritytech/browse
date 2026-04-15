export interface AppEntry {
  label: string
  name: string | null
  description: string
  contentHash: string | null
  isLive: boolean
  vouchCount: number | null
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
  let filtered =
    mode === 'pcf'
      ? apps.filter((app) => app.source === 'pcf')
      : mode === 'bookmarks'
        ? apps.filter((app) => bookmarks?.has(app.label))
        : mode === 'following'
          ? apps.filter((app) => followedLabels?.has(app.label))
          : apps

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
