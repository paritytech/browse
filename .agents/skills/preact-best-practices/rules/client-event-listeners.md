---
title: Deduplicate Global Event Listeners
impact: LOW
impactDescription: single listener for N components
tags: client, event-listeners, subscription
---

## Deduplicate Global Event Listeners

When a hook binds a global (`window` / `document`) event listener, each component instance adds its own. For hotkeys, resize, scroll, or visibility listeners this can mean dozens of handlers firing per event. Move the single listener to module scope and have the hook only register its callback.

**Incorrect (N instances = N listeners):**

```tsx
import { useEffect } from 'preact/hooks'

function useKeyboardShortcut(key: string, callback: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === key) callback()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [key, callback])
}
```

Using this hook 10 times installs 10 listeners on `window.keydown`.

**Correct (N instances = 1 listener):**

```tsx
import { useEffect } from 'preact/hooks'

const keyCallbacks = new Map<string, Set<() => void>>()
let installed = false

function ensureListener() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (e) => {
    if (!e.metaKey) return
    const set = keyCallbacks.get(e.key)
    if (set) set.forEach((cb) => cb())
  })
}

export function useKeyboardShortcut(key: string, callback: () => void) {
  useEffect(() => {
    ensureListener()
    let set = keyCallbacks.get(key)
    if (!set) {
      set = new Set()
      keyCallbacks.set(key, set)
    }
    set.add(callback)
    return () => {
      set!.delete(callback)
      if (set!.size === 0) keyCallbacks.delete(key)
    }
  }, [key, callback])
}
```

The global listener is installed once on first use and never uninstalled — acceptable because it's a no-op when no callbacks are registered. The same shape works for `resize`, `scroll`, `visibilitychange`, `hashchange`, etc.
