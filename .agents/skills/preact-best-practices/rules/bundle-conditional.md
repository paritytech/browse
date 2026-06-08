---
title: Conditional Module Loading
impact: HIGH
impactDescription: loads large data only when needed
tags: bundle, conditional-loading, lazy-loading
---

## Conditional Module Loading

Load large data or modules only when a feature is activated.

**Example (lazy-load animation frames):**

```tsx
import { useEffect, useState } from 'preact/hooks'

function AnimationPlayer({
  enabled,
  setEnabled,
}: {
  enabled: boolean
  setEnabled: (v: boolean) => void
}) {
  const [frames, setFrames] = useState<Frame[] | null>(null)

  useEffect(() => {
    if (enabled && !frames) {
      import('./animation-frames.js')
        .then((mod) => setFrames(mod.frames))
        .catch(() => setEnabled(false))
    }
  }, [enabled, frames, setEnabled])

  if (!frames) return <Skeleton />
  return <Canvas frames={frames} />
}
```

This pattern fits well for any JSON or data module that's only needed on a specific tab/mode — for example, debug-only data modules (see `setupDebugConsole`) could be fetched this way.
