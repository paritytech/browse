---
name: contributing
description: Audit the doc-comments and prose in a change against CONTRIBUTING.md and fix what violates the rules. Use before committing or opening a PR, or when asked to check changes against CONTRIBUTING.md. Style-only, not a code review.
---

# Contributing check

Audit the comment and JSDoc prose in a change against the repo-root
`CONTRIBUTING.md` style rules, then fix what violates them. Scope is prose inside
comments and doc-comments only. This is not a code review. For code quality use
`/simplify`, for correctness use `/review-pr`.

## Phase 0: Gather scope

Read the repo-root `CONTRIBUTING.md` first. It is the source of truth. The checks
below are its current form. If the file has changed, follow the file.

Get the diff under review:

- `git diff @{upstream}...HEAD`, falling back to `git diff main...HEAD` or
  `git diff HEAD~1` when there is no upstream.
- If there are uncommitted changes, or the range diff is empty, also run
  `git diff HEAD` and include the working tree.
- If a PR number, branch, or path was passed as an argument, review that instead.

Only added lines are in scope, plus any file the change rewrote whole.

## Phase 1: Mechanical sweep

Run these over the added lines and the new or rewritten files. Each is an
objective violation once you confirm it sits in a comment or doc-comment, not in
code or a string literal.

- Em-dash `—`. Rewrite as two sentences or a comma.
- Unicode arrows `→` `←` `↔`. Rewrite the sentence.
- `on-chain`. Say "network" or drop it.
- Possessive `'s`: pattern `[A-Za-z]'s `. MANUAL confirm each hit. `it's`,
  `that's`, `here's` are contractions and allowed. Only the possessive is a
  violation. Drop the `'s`.
- Semicolon in prose: a `//` or `*` line where `;` joins two clauses. Split into
  two sentences. Code semicolons and `for (;;)` do not count.
- Prose-conjunction `+`: ` + ` standing in for "and" or "then" in a sentence.
- Decorative separators: `// -----`, `// =====`, and similar dividers.

Illustrative one-pass scan of added comment lines, adjust the range:

```sh
git diff HEAD | grep -nE '^\+' | grep -nE '—|→|←|↔|on-chain|[A-Za-z]'"'"'s '
grep -rnE '^\s*(//|\*).*; ' <changed-files>
```

## Phase 2: Judgment pass

Read each changed doc-comment for the rules a grep cannot catch:

- Leads with one sentence stating WHAT, not HOW. Extra context goes after a blank
  line.
- Does not restate the signature or the code below it.
- No parenthetical asides. Fold the detail into the sentence or cut it. Technical
  notation like `CIDv1(raw, blake2b-256)` or `getEntries()` is not an aside.
- Does not name the variable in its own doc. Describe what the value holds.
- Prefers full words to abbreviations. `cid`, `evm`, `sdk` are allowed.

## Phase 3: Fix

Rewrite each real violation in place, preserving meaning. Two short sentences beat
one joined by a dash or semicolon. Skip false positives, a contraction, a code
semicolon, technical notation, and note each skip rather than arguing with it. Do
not touch prose outside the change unless the change rewrote the whole file.

## Phase 4: Report and verify

Summarize what was fixed and what was skipped. Then confirm the change still
builds: run the project `typecheck`, `lint`, and prettier over the touched files.
A comment rewrite can still trip prettier line-length, so do not skip it. Never
claim a check passed without running it.
