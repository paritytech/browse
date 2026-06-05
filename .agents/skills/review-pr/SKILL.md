---
name: review-pr
description: Read-only review of a GitHub pull request. Use when asked to review a PR, look at a PR, or assess readiness to land. Never push, merge, or modify code intended to keep.
---

# Review PR

## Overview

Read-only review producing a structured report.

## Inputs

- Ask for PR number or URL.
- If missing, always ask.
- If the URL is a different `owner/repo`, pass `--repo <owner>/<repo>` to every `gh` call.

## Safety

- Never push, merge, or modify code intended to keep.
- Work only in `.claude/worktrees/pr-<PR>`.
- Never auto-post the review.

## Steps

### Step 1: Setup worktree

```sh
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
gh auth status

WORKTREE_DIR=".claude/worktrees/pr-<PR>"
git fetch origin main

if [ -d "$WORKTREE_DIR" ]; then
  cd "$WORKTREE_DIR"
  git fetch origin main
else
  git worktree add "$WORKTREE_DIR" -b review/pr-<PR> origin/main
  cd "$WORKTREE_DIR"
fi
```

Run all subsequent commands in the worktree.

### Step 2: PR metadata

```sh
gh pr view <PR> --json number,title,author,baseRefName,headRefName,headRefOid,state,isDraft,body,files,additions,deletions,labels,reviewDecision,statusCheckRollup
gh pr checks <PR>
```

### Step 3: Claim PR (best effort)

```sh
gh_user=$(gh api user --jq .login)
gh pr edit <PR> --add-assignee "$gh_user" || echo "Could not assign reviewer, continuing"
```

### Step 4: Baseline check on main

Before reviewing the diff, check whether the changed area already has relevant code on the base branch. This catches duplicate implementations and helps assess whether the PR is additive or replacing existing logic.

```sh
gh pr diff <PR> --name-only
```

For the primary files changed, search main for existing implementations of the same functionality. Use grep or Read to inspect the base-branch versions of touched files.

### Step 5: Read the full diff (merge-base scoped)

```sh
git fetch origin pull/<PR>/head:pr-<PR>
git checkout pr-<PR>
MERGE_BASE=$(git merge-base origin/main pr-<PR>)
git diff --stat "$MERGE_BASE"..pr-<PR>
gh pr diff <PR>
```

For deeper context on specific files, Read them directly at the PR head rather than relying on the unified diff. If the diff is very large (>2000 lines), read it in stages by file grouping.

Read changed files against the repo-root `CLAUDE.md` rules.

### Step 6: Automated verification

Check CI status first. Run local checks only if CI is unavailable or incomplete.

```sh
gh pr checks <PR>
```

If CI is green, note it and skip redundant local checks. If CI is failing or unavailable, run locally inside the review worktree:

```sh
npm run typecheck 2>&1 | tail -30
npm run lint 2>&1 | grep -Ei "error" | head -30
npm run format:check 2>&1 | tail -10
```

For E2E-touching changes, run the relevant Playwright spec:

```sh
npx playwright test --config tests/playwright.config.ts tests/<file>.spec.ts --grep "<pattern>"
```

Note which checks ran, were skipped, or were deferred to CI.

### Step 7: Evaluate change value

- What user, operator, or developer pain does this solve?
- Is this the smallest reasonable fix, or is scope creeping?
- Are we introducing complexity for marginal benefit?
- Does this change behavior or contract in a way that needs docs or a release note?

### Step 8: Implementation quality

Evaluate each dimension. Only flag items that actually apply.

- **Correctness**: edge cases, error handling, null or undefined, concurrency, ordering.
- **Design**: is the abstraction appropriate or over/under-engineered?
- **Performance**: hot paths, allocations, unnecessary re-renders, bundle size impact.
- **Security and privacy**: authz, input validation, secrets exposure, PII in logs.
- **Backwards compatibility**: public APIs, config changes, migrations, package exports.
- **Style consistency**: matches patterns used elsewhere in the codebase.


### Step 9: Tests and verification

- What is covered by existing tests (unit, integration, e2e)?
- Are there regression tests for the specific bug or scenario?
- Missing test cases? Name exact scenarios that should be added.
- Do existing tests assert important behavior, or just happy-path or snapshots?

### Step 10: Cross-file impact

For any changed function signature, exported type, or public API:

- Search for all import sites and callers.
- Flag potential breakage in consumers.
- Check if changes ripple into other apps or packages.

### Step 11: Follow-up assessment

- Code that should be simplified before merge vs. after.
- TODOs: should they be tickets or addressed now?
- Deprecations, docs, types, or lint rules to adjust.
- Can we fix everything in a follow-up, or must the contributor update this PR?

## Output Format

Produce the review with these sections. Skip empty sections.

### A) Recommendation

One of:

- **READY FOR MERGE**. No blockers, ship it.
- **NEEDS WORK**. Blockers exist, PR author must address them.
- **NEEDS DISCUSSION**. Design or scope questions that need alignment before proceeding.

1 to 3 sentence rationale.

### B) What changed

Brief bullet summary of the diff and behavioral changes.

### C) What's good

Bullets: correctness wins, simplicity, test coverage, good patterns, ergonomics.

### D) Concerns (actionable)

Numbered list. Mark each as:

- **BLOCKER**. Must fix before merge.
- **IMPORTANT**. Should fix before merge.
- **NIT**. Optional improvement.

For each: point to the file plus area (`path:line`) and propose a concrete fix or alternative.

### E) Automated check results

Summary of CI status and any local lint, typecheck, or test results from Step 6. Note any checks that were skipped.

### F) Tests

- What exists and covers.
- What is missing (specific scenarios).

### G) Follow-ups

Non-blocking refactors or tickets to open after merge.

## Tone

Direct. Do not restate what the PR does. Do not soften criticism with praise. Do not propose a sweeping refactor when a one-line fix works.

End the chat response with the PR URL.

## Guardrails

- Read-only.
- Do not delete the worktree. User may want to re-run checks.
- Merge-base scoped diff to avoid stale main drift.
