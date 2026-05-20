---
name: preact-best-practices
description: Preact performance optimization guidelines for SPAs built with Vite. This skill should be used when writing, reviewing, or refactoring Preact code to ensure optimal performance patterns. Triggers on tasks involving Preact components, data fetching, bundle optimization, or performance improvements.
license: MIT
metadata:
  version: "1.0.0"
---

# Preact Best Practices

Performance optimization guide for Preact applications (SPA + Vite). Forked from a React skill and trimmed: no SSR, no Next.js-specific guidance, no React 19 features that Preact doesn't provide.

## When to Apply

Reference these guidelines when:
- Writing new Preact components
- Implementing data fetching (TanStack Query, fetch, etc.)
- Reviewing code for performance issues
- Refactoring existing Preact code
- Optimizing bundle size or load times (smoldot, polkadot-api, etc.)

## Preact notes

- Hooks come from `preact/hooks` — `useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`.
- `memo`, `lazy`, `Suspense`, `startTransition`, `useTransition` come from `preact/compat`.
- Preact does not have React 19's `useEffectEvent` or `<Activity>` component. Rules that depended on those have been removed or rewritten with ref-based equivalents.
- This project is a Vite SPA: dynamic imports use native `import()` + `lazy()`, not `next/dynamic`. No SSR guards (`typeof window !== 'undefined'`) are required.

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Eliminating Waterfalls | CRITICAL | `async-` |
| 2 | Bundle Size Optimization | CRITICAL | `bundle-` |
| 3 | Client-Side Data Fetching | MEDIUM-HIGH | `client-` |
| 4 | Re-render Optimization | MEDIUM | `rerender-` |
| 5 | Rendering Performance | MEDIUM | `rendering-` |
| 6 | Advanced Patterns | LOW | `advanced-` |

## Quick Reference

### 1. Eliminating Waterfalls (CRITICAL)

- `async-defer-await` - Move await into branches where actually used
- `async-parallel` - Use Promise.all() for independent operations

### 2. Bundle Size Optimization (CRITICAL)

- `bundle-dynamic-imports` - Use Preact `lazy()` + dynamic `import()` for heavy components
- `bundle-defer-third-party` - Load analytics/logging lazily
- `bundle-conditional` - Load modules only when a feature is activated
- `bundle-preload` - Preload on hover/focus for perceived speed

### 3. Client-Side Data Fetching (MEDIUM-HIGH)

- `client-event-listeners` - Deduplicate global event listeners
- `client-passive-event-listeners` - Use passive listeners for scroll/touch

### 4. Re-render Optimization (MEDIUM)

- `rerender-defer-reads` - Don't subscribe to state only used in callbacks
- `rerender-memo` - Extract expensive work into memoized components
- `rerender-dependencies` - Use primitive dependencies in effects
- `rerender-derived-state` - Subscribe to derived booleans, not raw values
- `rerender-functional-setstate` - Use functional setState for stable callbacks
- `rerender-lazy-state-init` - Pass function to useState for expensive values
- `rerender-transitions` - Use startTransition for non-urgent updates

### 5. Rendering Performance (MEDIUM)

- `rendering-animate-svg-wrapper` - Animate div wrapper, not SVG element
- `rendering-content-visibility` - Use content-visibility for long lists
- `rendering-hoist-jsx` - Extract static JSX outside components
- `rendering-svg-precision` - Reduce SVG coordinate precision
- `rendering-conditional-render` - Use ternary, not && for conditionals

### 6. Advanced Patterns (LOW)

- `advanced-event-handler-refs` - Store event handlers in refs

## How to Use

Read individual rule files for detailed explanations and code examples:

```
rules/async-parallel.md
rules/bundle-dynamic-imports.md
```

Each rule file contains:
- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Additional context and references
