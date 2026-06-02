/**
 * The dotNS identity this browse deployment runs as.
 *
 * `SELF_DOTNS` is the full label like `browse.dot`. In prod the deployed host
 * (e.g. `browse.dot.li`) collapses to its `.dot` parent. In e2e / dev under
 * `localhost` the host name itself is used so the test host can derive a
 * product account that matches what the page believes it is.
 *
 * `SELF_LABEL` is the bare label form. `browse.dot` becomes `browse`. Used to
 * filter our own entry out of the published list in the All tab.
 */

const FALLBACK_DOTNS = 'browse.dot'

function resolveSelfDotns(): string {
  if (typeof window === 'undefined') return FALLBACK_DOTNS
  const hostname = window.location.hostname.toLowerCase()
  if (hostname.endsWith('.app.localhost') || hostname.endsWith('.app.dot')) return FALLBACK_DOTNS
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1') {
    return window.location.host.toLowerCase()
  }
  if (hostname.endsWith('.dot')) return hostname
  const segments = hostname.split('.')
  if (segments.length >= 3) return `${segments.slice(0, -2).join('.')}.dot`
  return FALLBACK_DOTNS
}

export const SELF_DOTNS = resolveSelfDotns()

export const SELF_LABEL = SELF_DOTNS.endsWith('.dot') ? SELF_DOTNS.slice(0, -4) : SELF_DOTNS
