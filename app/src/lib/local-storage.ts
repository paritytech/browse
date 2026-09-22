import { getHostLocalStorage } from '@parity/product-sdk/host'

export function isHosted(): boolean {
  const isIframe = window !== window.top
  const isWebview = (window as unknown as Record<string, unknown>)['__HOST_WEBVIEW_MARK__'] === true
  return isIframe || isWebview
}

export class LocalStorage {
  async readJSON<T>(key: string): Promise<T | null> {
    try {
      return await this.readJSONOrThrow<T>(key)
    } catch {
      return null
    }
  }

  /**
   * Like {@link readJSON}, but a store that cannot be read raises instead of
   * reading as an empty one. Callers that delete on "nothing there" need the
   * difference.
   */
  async readJSONOrThrow<T>(key: string): Promise<T | null> {
    if (isHosted()) {
      const store = await getHostLocalStorage()
      if (store) return (await store.readJSON(key)) as T
    }
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
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
