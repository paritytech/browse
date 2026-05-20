---
title: Defer Non-Critical Third-Party Libraries
impact: MEDIUM
impactDescription: keeps critical path small
tags: bundle, third-party, analytics, defer
---

## Defer Non-Critical Third-Party Libraries

Analytics, logging, and error tracking don't block user interaction. Import them lazily so they don't inflate the main chunk.

**Incorrect (blocks initial bundle):**

```tsx
import { Analytics } from 'some-analytics-library'

export function App() {
  return (
    <>
      <MainView />
      <Analytics />
    </>
  )
}
```

**Correct (loaded after the app is interactive):**

```tsx
import { lazy, Suspense } from 'preact/compat'

const Analytics = lazy(() =>
  import('some-analytics-library').then((m) => ({ default: m.Analytics }))
)

export function App() {
  return (
    <>
      <MainView />
      <Suspense fallback={null}>
        <Analytics />
      </Suspense>
    </>
  )
}
```

Alternative: fire-and-forget the side-effect import from `useEffect`, which avoids introducing a Suspense boundary for a component that renders nothing.

```tsx
useEffect(() => {
  void import('some-analytics-library').then((m) => m.init())
}, [])
```
