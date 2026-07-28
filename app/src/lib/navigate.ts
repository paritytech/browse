import { navigateTo } from '@parity/product-sdk/host'

import { isHosted } from './local-storage'
import { appLink } from './share-link'

/** Open an app by `.dot` label. Standalone goes through {@link appLink}, which knows the network. */
export function navigateToDomain(label: string) {
  if (isHosted()) {
    void navigateTo(`${label}.dot`)
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
export function redirectToApp(label: string): void {
  if (isHosted()) {
    void navigateTo(`${label}.dot`)
  } else {
    window.location.replace(appLink(label))
  }
}
