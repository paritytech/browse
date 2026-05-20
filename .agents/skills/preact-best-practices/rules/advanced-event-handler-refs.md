---
title: Store Event Handlers in Refs
impact: LOW
impactDescription: stable subscriptions
tags: advanced, hooks, refs, event-handlers, optimization
---

## Store Event Handlers in Refs

Preact doesn't have React 19's `useEffectEvent`. To get a stable subscription that always calls the latest handler, store the callback in a ref and update it in a layout effect.

**Incorrect (re-subscribes on every render):**

```tsx
import { useEffect } from 'preact/hooks'

function useWindowEvent(event: string, handler: (e: Event) => void) {
  useEffect(() => {
    window.addEventListener(event, handler)
    return () => window.removeEventListener(event, handler)
  }, [event, handler])
}
```

Every render creates a new `handler` identity, which re-runs the effect and re-subscribes — extra work on every render.

**Correct (stable subscription, always calls latest handler):**

```tsx
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'

function useWindowEvent<T extends Event>(event: string, handler: (e: T) => void) {
  const ref = useRef(handler)

  useLayoutEffect(() => {
    ref.current = handler
  })

  useEffect(() => {
    const listener = (e: Event) => ref.current(e as T)
    window.addEventListener(event, listener)
    return () => window.removeEventListener(event, listener)
  }, [event])
}
```

The subscription effect now depends only on `event`, so it runs once per event name. The handler identity no longer forces a re-subscribe, and the indirection through `ref.current` always invokes the newest closure.
