/**
 * The dotNS address a search string names, decided from the string alone.
 *
 * Pure over the raw input: no query state, no index, no snapshot. Whether the
 * address resolves is a separate question, and never a gate on navigating to it.
 * No minimum length either, since a single character is a registerable name.
 */

import { NETWORK } from './config'

/** Schemes a pasted address may carry. */
const SCHEME = /^(?:https?|dot):\/\//i

/** First character that begins a path, query, or fragment. None is part of an address. */
const PATH_START = /[/?#]/

/** A bare dotNS label: lowercase alphanumerics and inner hyphens. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/** Dangling hyphens, dropped so the card survives the keystroke between `host` and `host-app`. */
const TRAILING_HYPHENS = /-+$/

/**
 * A trailing network suffix, whole or part-typed, so the card survives typing it.
 *
 * Every prefix of the TLD counts, longest first, which is what keeps `calc.`,
 * `calc.pa` and `calc.paseo` all naming `calc` on a `.paseo` network.
 */
const TLD_SUFFIX = new RegExp(
  `\\.(?:${Array.from({ length: NETWORK.TLD.length }, (_, i) => NETWORK.TLD.slice(0, NETWORK.TLD.length - i)).join('|')})?$`
)

/**
 * The label as typed, normalized only enough to append the suffix once.
 *
 * What the card shows, so it echoes the input rather than the address the input
 * resolves to. `host-` stays `host-`, where {@link destinationFromQuery} gives
 * `host`.
 */
export function typedLabel(raw: string): string {
  let candidate = raw.trim().replace(SCHEME, '')
  const pathAt = candidate.search(PATH_START)
  if (pathAt !== -1) candidate = candidate.slice(0, pathAt)
  return candidate.toLowerCase().replace(TLD_SUFFIX, '')
}

/**
 * The bare label a raw search string names, or null when it names none.
 *
 * On a `.dot` network `calc`, `calc.`, `calc.do`, `calc-`, `CALC.DOT`, and
 * `https://calc.dot/x?y=1` all yield `calc`. `photo editor`, `calc.dot.dot`,
 * `-calc`, and `https://example.com` yield null.
 */
export function destinationFromQuery(raw: string): string | null {
  const candidate = typedLabel(raw).replace(TRAILING_HYPHENS, '')
  // A remaining dot means the input names something other than a bare label,
  // such as a web address. Those are out of scope for now.
  if (candidate.includes('.')) return null
  return LABEL.test(candidate) ? candidate : null
}
