# Docs Guide

This directory owns architecture and developer-reference docs for browse.

## Docs Content Rules

- Order keys, modules, and helpers alphabetically unless the section is explicitly describing runtime order, priority, or dispatch order.
- Use the same names the code uses (`browse:labels`, `syncAllApps`, `prefetchPcfApps`).
- Link every code reference to its source with a line anchor (`[lib/local-storage.ts](../apps/registry/src/lib/local-storage.ts)`, `[queries.ts:142](../apps/registry/src/state/apps/queries.ts#L142)`).
- Lead with one sentence. Anything more goes after a blank line.
- Don't restate types or signatures the code already declares.
