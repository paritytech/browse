import type { LabelEntry } from '../../db/labels'
import type { CertificateIdentity } from '../certificate-authorities/types'

/**
 * A product active compliance attestation from one certificate authority, used
 * to render the badge and the certificate modal.
 *
 * The issuer and presentation fields come from {@link CertificateIdentity}. The
 * rest describe the concrete attestation instance.
 */
export interface AppCertificate extends CertificateIdentity {
  /** Attestation id, the certificate fingerprint. */
  id: string
  /** Unix seconds the attestation was issued. */
  issuedAt: number
  /** Unix seconds it expires, or 0 for never. */
  expiresAt: number
}

export interface AppEntry {
  label: string
  name: string | null
  description: string
  iconCid: string | null
  contentHash: string | null
  isLive: boolean
  attestationCount: number | null
  hasUserAttested: boolean
  /** Active certificates from every trusted authority that certified this product. */
  certificates: AppCertificate[]
  /** Publish time in unix seconds, from `Publisher.publicationOf`, or null. */
  publishedAt: number | null
}

/** Map a persisted {@link LabelEntry} to a live {@link AppEntry}. */
export function labelToApp(l: LabelEntry): AppEntry {
  return {
    label: l.label,
    name: l.name,
    description: l.description,
    iconCid: l.iconCid ?? null,
    contentHash: l.contentHash,
    isLive: l.contentHash !== null,
    attestationCount: l.attestationCount,
    hasUserAttested: l.hasUserAttested,
    certificates: l.certificates ?? [],
    publishedAt: l.publishedAt ?? null
  }
}

export const FILTER_MODES = ['all', 'bookmarks', 'following'] as const
export type FilterMode = (typeof FILTER_MODES)[number]

export function isFilterMode(value: string): value is FilterMode {
  return (FILTER_MODES as readonly string[]).includes(value)
}

export const SORT_MODES = ['relevant', 'new'] as const
export type SortMode = (typeof SORT_MODES)[number]

export function isSortMode(value: string): value is SortMode {
  return (SORT_MODES as readonly string[]).includes(value)
}

export function displayName(app: AppEntry): string {
  return app.name ?? `${app.label}.dot`
}

// Ranking modifiers. See docs/ranking-algorithm.md.
const DEMAND_PRIOR = 1
const CERTIFIED_BOOST = 2.0
const INCOMPLETE_PENALTY = 0.6
const NEW_BOOST = 1.0
const NEW_HALF_LIFE_DAYS = 14
const DAY_MS = 86_400_000

/** An app is complete when it has an icon, a description, and live content. */
function isComplete(app: AppEntry): boolean {
  return app.iconCid !== null && app.description.trim() !== '' && app.isLive
}

/** Decaying launch boost from the publish time, or 1 when it is unknown. */
function freshness(app: AppEntry, nowMs: number): number {
  if (app.publishedAt == null) return 1
  const ageDays = Math.max(0, (nowMs - app.publishedAt * 1000) / DAY_MS)
  return 1 + NEW_BOOST * 0.5 ** (ageDays / NEW_HALF_LIFE_DAYS)
}

/** Composite ranking score for the All and Following tabs. Higher ranks first. */
export function rankScore(app: AppEntry, nowMs: number = Date.now()): number {
  const demand = DEMAND_PRIOR + (app.attestationCount ?? 0)
  const trust = app.certificates.length > 0 ? CERTIFIED_BOOST : 1
  const quality = isComplete(app) ? 1 : INCOMPLETE_PENALTY
  return demand * trust * quality * freshness(app, nowMs)
}

export function filterApps(
  apps: AppEntry[],
  query: string,
  mode: FilterMode = 'all',
  bookmarkedApps?: Set<string>,
  followingApps?: Set<string>,
  publishedApps?: Set<string>,
  sort: SortMode = 'relevant'
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

  // All and Following order by the chosen sort. "Relevant" ranks by the
  // composite score, then recommendation count, then name. "New" orders by
  // publish time (newest first, unpublished last), then falls back to relevance.
  // Bookmarks always stays alphabetical.
  if (mode === 'all' || mode === 'following') {
    const now = Date.now()
    if (sort === 'new') {
      return filtered.sort((a, b) => {
        const publishedA = a.publishedAt ?? -Infinity
        const publishedB = b.publishedAt ?? -Infinity
        if (publishedA !== publishedB) return publishedB - publishedA
        const scoreA = rankScore(a, now)
        const scoreB = rankScore(b, now)
        if (scoreA !== scoreB) return scoreB - scoreA
        return displayName(a).localeCompare(displayName(b))
      })
    }
    return filtered.sort((a, b) => {
      const scoreA = rankScore(a, now)
      const scoreB = rankScore(b, now)
      if (scoreA !== scoreB) return scoreB - scoreA
      const countA = a.attestationCount ?? 0
      const countB = b.attestationCount ?? 0
      if (countA !== countB) return countB - countA
      return displayName(a).localeCompare(displayName(b))
    })
  }
  return filtered.sort((a, b) => displayName(a).localeCompare(displayName(b)))
}
