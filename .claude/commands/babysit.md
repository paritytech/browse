---
description: Monitor the current PR until it is ready to merge. Checks CI, addresses review comments, rebases, and pushes fixes.
allowed-tools: Bash(gh pr:*), Bash(gh api:*), Bash(gh run:*), Bash(git rebase:*), Bash(git push:*), Bash(git add:*), Bash(git commit:*), Bash(git status:*), Bash(git fetch:*), Bash(git diff:*), Bash(npm run lint:*), Bash(npm run typecheck:*), Bash(npm run test:*), Bash(npm run format:*)
---

## Context

- Current branch: !`git branch --show-current`
- Current PR: !`gh pr view --json number,url,headRefName,state,title,reviewDecision,mergeStateStatus,mergeable 2>/dev/null || echo "No PR found for current branch"`

## Your task

Monitor this PR and fix everything blocking merge. Run the loop below, up to 5 iterations. Stop early if the PR is green and review-clean.

### Step 1: Gather status

Run these in parallel:
- `gh pr checks` — CI status
- `gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | select(.position != null) | {user: .user.login, body: .body, path: .path, line: .line, created_at: .created_at}'` — unresolved review comments
- `gh pr view --json reviews --jq '.reviews[] | select(.state != "APPROVED") | {author: .author.login, state: .state, body: .body}'` — non-approved reviews
- `gh pr view --json mergeStateStatus,mergeable` — merge state

### Step 2: Triage (priority order)

1. **CI failures** — tests, lint, build, typecheck
2. **Review comments** — unresolved reviewer feedback
3. **Merge conflicts** — branch behind or conflicting

If nothing is blocking, report that the PR is ready and stop.

### Step 3: Fix CI failures

For each failing check:
1. Get logs: `gh run view <run_id> --log-failed`
2. Identify the root cause
3. Fix it in code
4. Run the relevant check locally to verify (lint, typecheck, test)
5. Commit and push

### Step 4: Address review comments

For each unresolved comment:
1. Read the reviewer's request
2. Make the code change
3. Commit with a message referencing the feedback

### Step 5: Rebase if needed

Only if `mergeStateStatus` indicates the branch is behind:
1. `git fetch origin main`
2. `git rebase origin/main`
3. `git push --force-with-lease`

Do NOT rebase if there are no conflicts and the branch is not behind.

### Step 6: Push and re-check

1. Push all new commits
2. Re-run Step 1 to verify
3. Report a summary: what was fixed, what remains

### Step 7: Loop or stop

- If all checks pass and no unresolved comments: report "PR is ready to merge" and stop
- If issues remain and iteration < 5: go to Step 1
- If iteration = 5: report remaining issues and stop

## Rules

- Never force-push to main/master
- Never skip pre-commit hooks (no --no-verify)
- Create NEW commits for each fix (never amend)
- Do NOT auto-merge — only report when ready
- Do NOT dismiss reviews
- Respect project CLAUDE.md conventions
