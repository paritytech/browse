import type { Publication } from './publisher'

/**
 * Filter publications by a search query.
 *
 * Matches the query as a case insensitive substring of the bare label. An
 * empty or whitespace query keeps every publication.
 */
export function filterPublications(list: Publication[], query: string): Publication[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((publication) => publication.label.includes(q))
}
