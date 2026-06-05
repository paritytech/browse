import { hostLocalStorage } from '@novasamatech/host-api-wrapper'

export function isHosted(): boolean {
  const isIframe = window !== window.top
  const isWebview = (window as unknown as Record<string, unknown>)['__HOST_WEBVIEW_MARK__'] === true
  return isIframe || isWebview
}

export class LocalStorage {
  async readJSON<T>(key: string): Promise<T | null> {
    try {
      if (isHosted()) {
        return (await hostLocalStorage.readJSON(key)) as T
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
        await hostLocalStorage.writeJSON(key, value)
      } else {
        window.localStorage.setItem(key, JSON.stringify(value))
      }
    } catch {
      // silent fail
    }
  }
}

export const localStorage = new LocalStorage()
