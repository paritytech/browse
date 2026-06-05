/**
 * The dotNS identity this browse deployment runs as.
 *
 * Driven by the `APP_DOTNS_DOMAIN` env var (the bare label, e.g. `browse`),
 * defaulting to `browse`. `SELF_LABEL` is that label; `SELF_DOTNS` is its full
 * `.dot` form. `SELF_LABEL` filters our own entry out of the published list,
 * and `SELF_DOTNS` derives the product account.
 */

declare const process: { env?: Record<string, string | undefined> }

// The browser bundle reads import.meta.env. Playwright fixtures read process.env.
const APP_DOTNS_DOMAIN =
  import.meta.env?.APP_DOTNS_DOMAIN ?? process.env?.APP_DOTNS_DOMAIN ?? 'browse'

export const SELF_LABEL = APP_DOTNS_DOMAIN.toLowerCase().replace(/\.dot$/, '')

export const SELF_DOTNS = `${SELF_LABEL}.dot`
