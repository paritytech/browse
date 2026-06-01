import type { RootManifest } from './types.js'

/**
 * Strict parser for the root manifest stored at `ContentResolver.text(node, "manifest")`.
 *
 * Returns `null` if the input isn't valid JSON, doesn't carry `$v: 1`, or is
 * missing any required field. Unknown fields are ignored. Callers should treat
 * `null` as "label has no usable manifest" and fall back to display-only state.
 */
export function parseRootManifest(raw: string): RootManifest | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const m = obj as Record<string, unknown>
  if (m['$v'] !== 1) return null
  if (typeof m['displayName'] !== 'string' || m['displayName'].length === 0) return null
  if (typeof m['description'] !== 'string') return null
  const icon = m['icon'] as Record<string, unknown> | undefined
  if (!icon || typeof icon['cid'] !== 'string' || icon['cid'].length === 0) return null
  if (icon['format'] !== 'png' && icon['format'] !== 'jpeg') return null
  return {
    $v: 1,
    displayName: m['displayName'],
    description: m['description'],
    icon: { cid: icon['cid'], format: icon['format'] }
  }
}
