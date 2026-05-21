import { localStorage } from '../../lib/local-storage'

const KEY = 'browse:contacts'

export interface ContactEntry {
  address: string
}

export async function getContacts(): Promise<ContactEntry[]> {
  try {
    const data = await localStorage.readJSON<unknown[]>(KEY)
    if (!Array.isArray(data)) return []
    return data
      .map((item: unknown): ContactEntry | null => {
        if (typeof item === 'string') return { address: item }
        if (item && typeof item === 'object' && 'address' in item) {
          return { address: String((item as { address: unknown }).address) }
        }
        return null
      })
      .filter((entry): entry is ContactEntry => entry !== null)
  } catch {
    return []
  }
}

export async function addContact(address: string): Promise<void> {
  const contacts = await getContacts()
  if (!contacts.some((contact) => contact.address === address)) {
    contacts.push({ address })
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
