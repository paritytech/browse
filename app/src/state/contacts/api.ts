import { localStorage } from '../../lib/local-storage'

const KEY = 'browse:contacts'

export interface ContactEntry {
  address: string
  username?: string
}

export async function getContacts(): Promise<ContactEntry[]> {
  try {
    const data = await localStorage.readJSON<unknown[]>(KEY)
    if (!Array.isArray(data)) return []
    return data.map((item: unknown) =>
      typeof item === 'string' ? { address: item } : (item as ContactEntry)
    )
  } catch {
    return []
  }
}

export async function addContact(address: string, username?: string): Promise<void> {
  const contacts = await getContacts()
  if (!contacts.some((c) => c.address === address)) {
    contacts.push({ address, username })
    await localStorage.writeJSON(KEY, contacts)
  }
}

export async function removeContact(address: string): Promise<void> {
  const contacts = await getContacts()
  await localStorage.writeJSON(
    KEY,
    contacts.filter((c) => c.address !== address)
  )
}
