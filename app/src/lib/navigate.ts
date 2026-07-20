import { hostApi } from '@novasamatech/host-api-wrapper'

import { appLink } from './share-link'

export function navigateToDomain(label: string) {
  if (hostApi?.navigateTo) {
    hostApi.navigateTo({ tag: 'v1', value: `${label}.dot` })
  } else {
    window.open(`https://${label}.dot.li`, '_blank', 'noopener')
  }
}

/**
 * Send the user straight into an app, replacing the current page so no browse UI
 * is shown. Used for the `?app=` share pass-through: inside the host we swap the
 * active app; on plain web we replace the tab's location (not a new tab) so the
 * redirect is seamless.
 */
export function redirectToApp(label: string): void {
  if (hostApi?.navigateTo) {
    hostApi.navigateTo({ tag: 'v1', value: `${label}.dot` })
  } else {
    window.location.replace(appLink(label))
  }
}
