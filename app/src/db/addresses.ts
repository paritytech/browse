import { localStorage } from '../lib/local-storage'

const KEY = 'browse:addresses'

export type AddressMap = Record<string, string>

export async function readAllAddresses(): Promise<AddressMap> {
  return (await localStorage.readJSON<AddressMap>(KEY)) ?? {}
}

export async function writeAllAddresses(map: AddressMap): Promise<void> {
  await localStorage.writeJSON(KEY, map)
}
