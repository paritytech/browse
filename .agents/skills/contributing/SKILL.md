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

Only added lines are in scope, plus any file the change rewrote whole. One
exception, in Phase 2: a comment the change made false.

The work may not live in the directory you are standing in. `git worktree list`
first, and audit the worktree that holds the change, not the session cwd. If
several worktrees carry uncommitted work, ask which one, or audit each and say
which you covered.

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
- Prose touching a `// Given` / `// When` / `// Then` marker. The markers are bare
  headers. A comment line directly above or below one still reads as a
  descriptive marker block, so it breaks the rule as surely as text on the marker
  line does. Move it into the test name, or cut it.

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

Then four that catch the comments nobody wants to read. All four are about
comments that were written for the author, not the next reader:

- **Length.** A comment carrying more than two or three lines of prose is usually
  an argument, not documentation. Keep the non-obvious reason, cut the case for it.
- **No history.** "It was 24px, which held the row taller than its contents" tells
  the reader about a value that no longer exists. The old value is in git. State
  what the current one is for.
- **No restating measured values.** If the declaration says `15px`, a comment
  repeating 15px goes stale the moment it changes. Comment the intent, or the fact
  that the value is deliberately off-scale, not the number.
- **No outside references as if they were constraints.** Naming another product
  ("matches the App Store lockup", "as Google does") reads as a rule the code must
  honour, cannot be verified from inside the repo, and rots when they redesign.
  Cite the in-repo token or the design system instead. A one-clause nod to where an
  idea came from is fine when the value itself is local.

Also check whether the change **falsified a neighbouring comment**. This is the one
case where prose outside the diff is in scope: a comment describing behaviour the
change altered is now a lie, and leaving it is worse than the original violation.
Rewrite it and say you did.

## Phase 3: Fix

Rewrite each real violation in place, preserving meaning. Two short sentences beat
one joined by a dash or semicolon. Skip false positives, a contraction, a code
semicolon, technical notation, and note each skip rather than arguing with it.
Beyond a comment the change falsified, do not touch prose outside the change unless
the change rewrote the whole file.

## Phase 4: Report and verify

Summarize what was fixed and what was skipped. Then confirm the change still
builds: run the project `typecheck`, `lint`, and prettier over the touched files.
A comment rewrite can still trip prettier line-length, so do not skip it. Never
claim a check passed without running it.
