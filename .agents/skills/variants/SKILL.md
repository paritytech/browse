---
name: variants
description: Stand up several design variants of the app side by side, each in its own worktree on its own port, so they can be compared live in a browser. Use when asked to try more than one option for a UI change, to see options rather than read about them, or to compare a change against main. Tears them down again on request.
---

# Variants side by side

Build N versions of a UI change at once, each on its own branch and port, and hand
back a table of URLs. The point is to let a decision be made by looking rather than
by argument, and to keep the rejected options alive while the choice is still open.

Use this when the ask is "show me a few options", "what else could we try", or
"compare this against main". For a single change, a single worktree is enough.

## Phase 1: Agree the option list first

Write the option list down and get it confirmed before building anything. Each
option needs a short id (used for the branch, the directory, and the label) and one
sentence on what makes it different. Building the wrong five is the expensive
mistake, not building slowly.

Keep it to what a person can hold in their head. Five is a lot already.

## Phase 2: One worktree per option, all off main

```sh
git fetch origin
git worktree add ../<repo>-<id> -b variant/<id> origin/main
cd ../<repo>-<id> && bun install
```

Off `origin/main`, never off the current branch: a variant that inherits unrelated
in-flight work cannot be judged, and cannot be landed on its own.

`bun install` per worktree is unavoidable and takes about 30 seconds each. Run them
in parallel.

Implement the same behaviour in each, differing only in the one dimension under
comparison. Anything else that differs, type scale, copy, a suppression rule, will
be read as part of the option and will corrupt the comparison. When a shared
decision changes mid-flight, apply it to every variant before showing them again.

## Phase 3: A port each, and check the port is free

```sh
lsof -nP -iTCP -sTCP:LISTEN        # what is already taken
bun run --cwd <worktree>/app dev:paseo -- --port <port> --strictPort
```

Never assume a port is yours. Developer machines have other projects on 3000-3005,
and without `--strictPort` Vite silently takes the next one, so you end up
comparing two windows onto the same variant. Pick from the free list, and say in
the final table which port went where.

These apps blank outside a Host webview, so each port also needs a Host in front of
it. `app/scripts/mock-host.ts` does that for one port. For several, one process can
hold several hosts, which keeps the process count down.

## Phase 4: Report as a table, and do not open anything

Give one row per option: label, what differs, worktree, branch, port, and the Host
URL to open. Print the URLs as text. Do not launch a browser, and do not open one
tab per variant.

Then say what you would pick and why, in a sentence or two. The comparison is the
deliverable, but a recommendation is still owed.

## Phase 5: Teardown

The variants outlive the decision unless someone clears them, and each one is a
full `node_modules`. Once a winner is chosen, offer to:

```sh
git worktree remove --force ../<repo>-<id>       # discards uncommitted work
git branch -D variant/<id>                        # only if it holds no commits
```

Say plainly what each removal discards before running it. Keep the winner, and keep
anything the user has said they still want to look at.

## Checklist

1. Option list written and confirmed, one dimension of difference each.
2. A worktree per option off `origin/main`, installed in parallel.
3. Free ports only, `--strictPort`, a Host in front of each.
4. A table of URLs as text, plus a recommendation. Nothing opened.
5. Teardown offered once the choice is made, with what it discards spelled out.
