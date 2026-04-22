import { useCallback, useLayoutEffect, useRef } from 'preact/hooks'

/**
 * Stable callback that always invokes the latest `fn`.
 *
 * Equivalent to React 19's `useEffectEvent`. Useful for handlers passed to
 * memoised children or effects whose subscription shouldn't re-fire when the
 * handler closes over new state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useEvent<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, [])
}
