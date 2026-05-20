# E2E Test Conventions

## Given/When/Then markers MUST be bare

In Playwright test files, the `// Given`, `// When`, `// Then` markers are
section headers — nothing else. **No descriptive text after them. Ever.**

```ts
// ❌ WRONG — never do this
// Given — seed the cache with stale data
// When — user clicks the tab
// Then — sync runs and updates the entry

// ✅ CORRECT
// Given
// When
// Then
```

This applies to test code AND to test snippets in chat / PR descriptions /
review comments. If you're tempted to explain what's happening in that block,
the explanation belongs in the test name or as a separate comment line — not
inline with the marker.
