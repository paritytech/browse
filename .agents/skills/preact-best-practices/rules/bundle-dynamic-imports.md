---
title: Dynamic Imports for Heavy Components
impact: CRITICAL
impactDescription: directly affects time-to-interactive
tags: bundle, dynamic-import, code-splitting, vite, preact-lazy
---

## Dynamic Imports for Heavy Components

Use Preact's `lazy()` + native dynamic `import()` to split heavy components into their own chunk so the main bundle stays small. Vite handles code-splitting automatically on any `import()` call.

**Incorrect (editor bundles with main chunk):**

```tsx
import { MonacoEditor } from './monaco-editor'

function CodePanel({ code }: { code: string }) {
  return <MonacoEditor value={code} />
}
```

**Correct (editor loads on demand):**

```tsx
import { lazy, Suspense } from 'preact/compat'

const MonacoEditor = lazy(() =>
  import('./monaco-editor').then((m) => ({ default: m.MonacoEditor }))
)

function CodePanel({ code }: { code: string }) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <MonacoEditor value={code} />
    </Suspense>
  )
}
```

**When to apply in this project:** any dependency that dominates the bundle and is only needed on one flow. Obvious candidates include `smoldot` (the embedded light client — only needed once a chain connection is opened) and any modal/panel that the user may never open.
