# Bash command construction (keep commands auto-approvable)

The permission engine matches each sub-command of a Bash call against the
allowlist by prefix, and prompts unless **every** sub-command matches. Defensive
scaffolding (`export`, `cd`, `echo`, variable expansion) is inherently
un-allowlistable and forces a prompt. Keep commands plain:

- One command per call. Don't bundle multiple statements with newlines/`&&`/`;`
  when separate tool calls work.
- No pipes into a second tool (`… | grep`, `… | jq`). The piped-to command is a
  separate sub-command needing its own allowlist rule; if it lacks one the whole
  call prompts. Get the raw output and filter it yourself, or use a single tool
  that does both (e.g. `git grep <ref>` instead of `git show <ref> | grep`).
- No redirections (`2>/dev/null`, `>out.txt`). Redirect operators are shell
  scaffolding, not prefix-matchable, so they force a prompt. Let stderr surface.
- No `cd` — use absolute paths (the shell already runs in the repo).
- No `export PATH=…` or other env-var scaffolding; tools are already on PATH.
- No `echo` banners around command output.
- Read files with the Read tool, not `cat`/`head`/`tail`.

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
