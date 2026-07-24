import type { ThemeMode } from '@novasamatech/host-api-wrapper'

const KNOWN_FAMILIES = new Set(['berlin', 'tokyo', 'lisbon', 'malta'])

/**
 * Map the host's theme payload to one of our `data-theme` attribute values.
 *
 * The host sends two independent axes: `name` picks the theme family and
 * `variant` picks light vs dark. We keep them independent — each family has a
 * `<family>Day` and `<family>Night` token set — so dark applies to every
 * family, not just berlin. `Default` and unknown families fall back to berlin.
 *
 * This module stays free of browser-coupled imports so the mapping can be
 * unit-tested on its own.
 */
export function resolveHostTheme(theme: ThemeMode): string {
  const family =
    theme.name.tag === 'Custom' && KNOWN_FAMILIES.has(theme.name.value)
      ? theme.name.value
      : 'berlin'
  return `${family}${theme.variant === 'Light' ? 'Day' : 'Night'}`
}
