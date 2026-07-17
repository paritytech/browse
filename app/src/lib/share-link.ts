import { NETWORK, SELF_LABEL } from './config'

/** Query param carrying the app domain a share link points at. */
const APP_PARAM = 'app'
/** Query param carrying the sharing user's username, when a link supplies one. */
const FROM_PARAM = 'from'

/** True when browse is running against a local dev server. */
function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname.toLowerCase()
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1'
}

/** Direct public URL that opens an app straight away, e.g. `https://calculator.paseo.li`. */
export function appLink(label: string): string {
  return `https://${label}.${NETWORK.primaryWebDomain}`
}

/**
 * Shareable browse link. Opened in browse it is a pass-through: browse records
 * the intent and redirects straight into the app, then asks the opener to
 * recommend it on a later visit.
 *
 * On a local dev server the link routes through the network dev host back to
 * this instance, e.g. `https://paseoli.dev/localhost:3000?app=calculator`, so a
 * shared link is testable end to end. In production it targets browse itself,
 * e.g. `https://browse.paseo.li?app=calculator`.
 */
export function shareLink(label: string): string {
  const query = `?${APP_PARAM}=${encodeURIComponent(label)}`
  if (isLocalhost()) {
    const authority = window.location.port ? `localhost:${window.location.port}` : 'localhost'
    return `https://${NETWORK.secondaryWebDomain}/${authority}${query}`
  }
  return `https://${SELF_LABEL}.${NETWORK.primaryWebDomain}${query}`
}

export interface SharedApp {
  label: string
  from?: string
}

/** Parse an incoming `?app=<label>&from=<username>` browse link. */
export function parseSharedApp(search: string): SharedApp | null {
  const params = new URLSearchParams(search)
  const raw = params.get(APP_PARAM)
  if (!raw) return null
  const label = raw
    .trim()
    .toLowerCase()
    .replace(/\.dot$/, '')
  if (!label) return null
  const from = params.get(FROM_PARAM)?.trim() || undefined
  return { label, from }
}
