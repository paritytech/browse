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
    certificates: l.certificates ?? []
  }
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

  // All and Following rank by recommendation count, then name. Bookmarks stays
  // alphabetical.
  if (mode === 'all' || mode === 'following') {
    return filtered.sort((a, b) => {
      const upvotesA = a.attestationCount ?? 0
      const upvotesB = b.attestationCount ?? 0
      if (upvotesA !== upvotesB) return upvotesB - upvotesA
      return displayName(a).localeCompare(displayName(b))
    })
  }
  return filtered.sort((a, b) => displayName(a).localeCompare(displayName(b)))
}
