/**
 * A username and the SS58 account that owns it, resolved from the People chain
 * DotNS `Resources.UsernameOwnerOf` map. The Following search reads these from
 * the daily verifiable snapshot in `usernames-snapshot.ts` rather than querying
 * the chain live.
 */
export interface UsernameEntry {
  username: string
  account: string
}
