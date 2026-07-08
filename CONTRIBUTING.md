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
7. **No em-dashes, semicolons, prose-conjunction `+`, or Unicode arrows (`→`, `←`, `↔`).** Rewrite the sentence. Two short sentences read better than one long one with a dash, and arrows belong in diagrams (where `->` is fine if it's a real arrow, not a stand-in for "becomes" or "then").

   Bad: `Click upvote → cache patches → toast confirms.`
   Good: `Click upvote. The cache patches optimistically. A toast confirms.`
8. **No possessive apostrophes.** Drop the `'s`.

   Bad: `Releases the identity's lock so it can attest again.`
   Good: `Releases the identity lock so it can attest again.`
9. **Minimize parenthetical asides.** A parenthetical usually means the sentence is carrying a detail it should either state plainly or drop. Fold it into the prose, or cut it.

   Bad: `Usernames live in the UsernameOwnerOf map (username bytes to owner SS58).`
   Good: `Usernames live in the UsernameOwnerOf map, which maps username bytes to an owner SS58 address.`
10. **Prefer full words to abbreviations.** In prose and in the names you reference. Established acronyms like `cid`, `evm`, and `sdk` are fine.

   Bad: `const att = decodeAttestation(data)`
   Good: `const attestation = decodeAttestation(data)`
11. **Don't write "on-chain".** Either omit it or say "network". The reader knows the data comes from the chain from context.

   Bad: `Discovered on-chain by enumerating schemas.`
   Good: `Discovered by enumerating schemas.` or `Read from the network by enumerating schemas.`
12. **Don't name the variable in its own doc.** The declaration already shows the name. Describe what the value holds, not what it is called.

   Bad: `` /** `badgeIconCid` (badge image) from the payload. */ `` above `badgeIconCid: string | null`
   Good: `/** Badge image CID from the payload. */` above `badgeIconCid: string | null`

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
 * Verifies a Substrate-style compact Merkle proof.
 *
 * Compact proofs (produced by `sp_trie::generate_trie_proof`) replace path
 * children with an empty inline placeholder and omit the target leaf's value.
 * Both are reconstructed during verification from `expected_value`, which for
 * state version V1 is hashed when its length is 32 bytes or more.
 */
```

### TLDR

1. Start with a single, clear sentence. Follow up after a newline if needed.
2. Don't repeat what the code already says.
3. Use examples and links generously.
4. If documenting something requires explaining too many unrelated concepts, reconsider the API design.
5. Rewrite around em-dashes, semicolons, prose `+`, and Unicode arrows. Short sentences are better.
6. No possessive apostrophes. "the account attestation", not "the account's".
7. Minimize parenthetical asides. Fold the detail into the sentence or drop it.
8. Prefer the full word to a truncated one. "certificate", not "cert".
9. Don't write "on-chain". Omit it or say "network".
10. Don't repeat the variable name in its own doc. Describe what it holds.
