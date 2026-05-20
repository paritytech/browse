---
title: Extract to Memoized Components
impact: MEDIUM
impactDescription: enables early returns
tags: rerender, memo, useMemo, optimization
---

## Extract to Memoized Components

Extract expensive work into memoized components to enable early returns before computation.

In Preact, import `memo` from `preact/compat` and `useMemo` from `preact/hooks`.

**Incorrect (computes avatar even when loading):**

```tsx
import { useMemo } from 'preact/hooks'

function Profile({ user, loading }: Props) {
  const avatar = useMemo(() => {
    const id = computeAvatarId(user)
    return <Avatar id={id} />
  }, [user])

  if (loading) return <Skeleton />
  return <div>{avatar}</div>
}
```

**Correct (skips computation when loading):**

```tsx
import { memo } from 'preact/compat'
import { useMemo } from 'preact/hooks'

const UserAvatar = memo(function UserAvatar({ user }: { user: User }) {
  const id = useMemo(() => computeAvatarId(user), [user])
  return <Avatar id={id} />
})

function Profile({ user, loading }: Props) {
  if (loading) return <Skeleton />
  return (
    <div>
      <UserAvatar user={user} />
    </div>
  )
}
```

Preact has no automatic memoization compiler — `memo()` and `useMemo()` still need to be applied manually where appropriate.
