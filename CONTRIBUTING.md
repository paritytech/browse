# Contributing to Browse

### How to Document

Good documentation starts with a single, clear sentence. Everything else comes after a newline.

#### Principles

1. **Lead with one sentence.** The first line of any doc comment should explain _what_ the thing does, not _how_. Additional context goes after a blank line.
2. **Don't restate the code.** If the function signature already tells the story, don't repeat it in prose. Document _why_, not _what_.
3. **Use examples.** A short usage example is worth more than a paragraph of explanation.
4. **Link to related items.** Help readers navigate. Reference related functions, types, or modules directly rather than describing them.
5. **Think about context.** If you're explaining too many foreign concepts to document one function, the API design may need work.
6. **No code section separators.** Don't use `// -----------` or similar decorative dividers to split sections within a file. Let the code structure speak for itself.

#### TypeScript

```ts
/** Resolve a `.dot` label to its IPFS CID via the dotNS contract. */
export async function resolveLabel(label: string): Promise<Cid | null> {
```

- Start with a single-sentence JSDoc comment.
- Add parameter/return descriptions only when the types aren't self-explanatory.
- For modules, put a block comment at the top of the file explaining the purpose and key design decisions.

```ts
/**
 * Two-build, CID-subdomain bridge.
 *
 * The host shell at name.dot.li resolves the label, then iframes
 * cid.app.dot.li with the resolved CID. Each CID gets a distinct origin so SW, storage, and auth stay isolated per app.
 */
```

### TLDR

1. Start with a single, clear sentence. Follow up after a newline if needed.
2. Don't repeat what the code already says.
3. Use examples and links generously.
4. If documenting something requires explaining too many unrelated concepts, reconsider the API design.
