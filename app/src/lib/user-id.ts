import { getAccountsProvider } from '@parity/product-sdk-host'

/**
 * The connected user's primary DotNS username, or `''` when the host is
 * unavailable, the user is not connected, or they have not revealed one.
 *
 * A non-interactive read: the host returns the value it already holds and never
 * prompts, so an empty string means "nothing to share", not "ask for permission".
 */
export async function getPrimaryUsername(): Promise<string> {
  const accountsProvider = await getAccountsProvider()
  if (!accountsProvider) return ''
  const username = await accountsProvider.getUserId().match(
    (ok) => ok.primaryUsername,
    () => ''
  )
  return username.trim()
}
