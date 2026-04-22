---
title: Defer State Reads to Usage Point
impact: MEDIUM
impactDescription: avoids unnecessary subscriptions
tags: rerender, searchParams, localStorage, optimization
---

## Defer State Reads to Usage Point

Don't subscribe to dynamic state (URL hash, localStorage) if you only read it inside callbacks. Reading on demand avoids a render pass every time that state changes.

**Incorrect (custom hook subscribes to every hash change, triggering renders):**

```tsx
function ShareButton({ chatId }: { chatId: string }) {
  const hash = useLocationHash()  // re-renders on every hash change

  const handleShare = () => {
    const ref = new URLSearchParams(hash.slice(1)).get('ref')
    shareChat(chatId, { ref })
  }

  return <button onClick={handleShare}>Share</button>
}
```

**Correct (reads on demand, no subscription):**

```tsx
function ShareButton({ chatId }: { chatId: string }) {
  const handleShare = () => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const ref = params.get('ref')
    shareChat(chatId, { ref })
  }

  return <button onClick={handleShare}>Share</button>
}
```

This also applies to `localStorage`: if a value is only consumed by a handler, read it when the handler fires instead of subscribing during render.
