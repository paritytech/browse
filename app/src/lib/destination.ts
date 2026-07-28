/**
 * The `.dot` address a search string names, decided from the string alone.
 *
 * Pure over the raw input: no query state, no index, no snapshot. Whether the
 * address resolves is a separate question, and never a gate on navigating to it.
 * No minimum length either, since `a.dot` is a registerable name.
 */

/** Schemes a pasted address may carry. */
const SCHEME = /^(?:https?|dot):\/\//i

/** First character that begins a path, query, or fragment. None is part of an address. */
const PATH_START = /[/?#]/

/** A bare dotNS label: lowercase alphanumerics and inner hyphens. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/** Dangling hyphens, dropped so the card survives the keystroke between `host` and `host-app`. */
const TRAILING_HYPHENS = /-+$/

/** A trailing `.dot`, whole or part-typed, so the card survives typing the suffix. */
const DOT_SUFFIX = /\.(?:d(?:o(?:t)?)?)?$/

/**
 * The label as typed, normalized only enough to append `.dot` once.
 *
 * What the card shows, so it echoes the input rather than the address the input
 * resolves to. `host-` stays `host-`, where {@link destinationFromQuery} gives
 * `host`.
 */
export function typedLabel(raw: string): string {
  let candidate = raw.trim().replace(SCHEME, '')
  const pathAt = candidate.search(PATH_START)
  if (pathAt !== -1) candidate = candidate.slice(0, pathAt)
  return candidate.toLowerCase().replace(DOT_SUFFIX, '')
}

/**
 * The bare `.dot` label a raw search string names, or null when it names none.
 *
 * `calc`, `calc.`, `calc.do`, `calc-`, `CALC.DOT`, and `https://calc.dot/x?y=1`
 * all yield `calc`. `photo editor`, `calc.dot.dot`, `-calc`, and
 * `https://example.com` yield null.
 */
export function destinationFromQuery(raw: string): string | null {
  const candidate = typedLabel(raw).replace(TRAILING_HYPHENS, '')
  // A remaining dot means the input names something other than a bare `.dot`
  // label, such as a web address. Those are out of scope for now.
  if (candidate.includes('.')) return null
  return LABEL.test(candidate) ? candidate : null
}
