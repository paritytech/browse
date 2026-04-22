import { localStorage } from '../lib/local-storage'

const KEY = 'browse:addresses'

type AddressMap = Record<string, string>

async function readAll(): Promise<AddressMap> {
  return (await localStorage.readJSON<AddressMap>(KEY)) ?? {}
}

export async function readSS58Address(h160Address: string): Promise<string | null> {
  const map = await readAll()
  return map[h160Address.toLowerCase()] ?? null
}

export async function updateSS58Address(h160Address: string, ss58: string): Promise<void> {
  const map = await readAll()
  map[h160Address.toLowerCase()] = ss58
  await localStorage.writeJSON(KEY, map)
}
