import { nameWithTld } from '@parity/browse-sdk'
import { HostUnavailableError, navigateTo } from '@parity/product-sdk/host'

import { NETWORK } from './config'
import { isHosted } from './local-storage'
import { appLink } from './share-link'

/**
 * Ask the host to open `label`.
 *
 * The host reports a refusal on the err channel of its result rather than
 * throwing, so dropping that result leaves a failed tap looking exactly like a
 * tap that did nothing.
 */
async function openInHost(label: string, onError?: (message: string) => void): Promise<void> {
  const result = await navigateTo(nameWithTld(label, NETWORK.TLD))
  if (result.ok) return
  console.error('navigateTo failed', result.error)
  onError?.(
    result.error instanceof HostUnavailableError ? 'Host unavailable' : 'Could not open app'
  )
}

/** Open an app by bare label. Standalone goes through {@link appLink}, which knows the network. */
export function navigateToDomain(label: string, onError?: (message: string) => void): void {
  if (isHosted()) {
    void openInHost(label, onError)
  } else {
    window.open(appLink(label), '_blank', 'noopener')
  }
}

/**
 * Send the user straight into an app, replacing the current page so no browse UI
 * is shown. Used for the `?app=` share pass-through: inside the host we swap the
 * active app; on plain web we replace the tab's location (not a new tab) so the
 * redirect is seamless.
 */
export function redirectToApp(label: string, onError?: (message: string) => void): void {
  if (isHosted()) {
    void openInHost(label, onError)
  } else {
    window.location.replace(appLink(label))
  }
}
