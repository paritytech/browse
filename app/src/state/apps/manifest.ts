/**
 * Root product manifest.
 */

export type IconFormat = 'jpeg' | 'png'

export interface RootManifest {
  $v: 1
  displayName: string
  description: string
  icon: { cid: string; format: IconFormat }
}

export function parseRootManifest(raw: string): RootManifest | null {
  if (!raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const manifest = obj as Record<string, unknown>
  if (manifest.$v !== 1) return null
  if (typeof manifest.displayName !== 'string' || manifest.displayName.length === 0) return null
  if (typeof manifest.description !== 'string') return null
  const icon = manifest.icon as Record<string, unknown> | undefined
  if (!icon || typeof icon.cid !== 'string' || icon.cid.length === 0) return null
  if (icon.format !== 'png' && icon.format !== 'jpeg') return null
  return {
    $v: 1,
    displayName: manifest.displayName,
    description: manifest.description,
    icon: { cid: icon.cid, format: icon.format as IconFormat }
  }
}
