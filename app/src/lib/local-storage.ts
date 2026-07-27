import { getHostLocalStorage } from '@parity/product-sdk/host'

export function isHosted(): boolean {
  const isIframe = window !== window.top
  const isWebview = (window as unknown as Record<string, unknown>)['__HOST_WEBVIEW_MARK__'] === true
  return isIframe || isWebview
}

export class LocalStorage {
  async readJSON<T>(key: string): Promise<T | null> {
    try {
      if (isHosted()) {
        const store = await getHostLocalStorage()
        if (store) return (await store.readJSON(key)) as T
      }
      const raw = window.localStorage.getItem(key)
      if (!raw) return null
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async writeJSON<T>(key: string, value: T): Promise<void> {
    try {
      if (isHosted()) {
        const store = await getHostLocalStorage()
        if (store) {
          await store.writeJSON(key, value)
          return
        }
      }
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // silent fail
    }
  }
}

export const localStorage = new LocalStorage()
