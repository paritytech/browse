/**
 * Filter labelled entries by a search query.
 *
 * Matches the query as a case insensitive substring of the bare label. An
 * empty or whitespace query keeps every entry.
 */
export function filterPublications<T extends { label: string }>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((entry) => entry.label.includes(q))
}
