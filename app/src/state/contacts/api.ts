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
    return data
      .map((item: unknown): ContactEntry | null => {
        if (typeof item === 'string') return { address: item }
        if (item && typeof item === 'object' && 'address' in item) {
          const record = item as { address: unknown; username?: unknown }
          const username = typeof record.username === 'string' ? record.username : undefined
          return { address: String(record.address), username }
        }
        return null
      })
      .filter((entry): entry is ContactEntry => entry !== null)
  } catch {
    return []
  }
}

export async function addContact(address: string, username?: string): Promise<void> {
  const contacts = await getContacts()
  if (!contacts.some((contact) => contact.address === address)) {
    contacts.push({ address, username })
    await localStorage.writeJSON(KEY, contacts)
  }
}

export async function removeContact(address: string): Promise<void> {
  const contacts = await getContacts()
  await localStorage.writeJSON(
    KEY,
    contacts.filter((contact) => contact.address !== address)
  )
}
