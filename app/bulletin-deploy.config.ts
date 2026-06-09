import { defineConfig } from 'bulletin-deploy'

declare const process: { env?: Record<string, string | undefined> }

// Set APP_DOTNS_DOMAIN to the bare label, e.g. `browse`.
const domain = process.env?.APP_DOTNS_DOMAIN
if (!domain) throw new Error('APP_DOTNS_DOMAIN is required')
const label = domain.toLowerCase().replace(/\.dot$/, '')

export default defineConfig({
  domain: `${label}.dot`,
  displayName: 'Browse',
  description: 'Home for privacy apps.',
  icon: { path: './icon.png', format: 'png' },
  executables: [
    {
      kind: 'app',
      path: './dist/spa',
      appVersion: [0, 1, 0]
    },
    {
      kind: 'widget',
      path: './dist/widget',
      appVersion: [0, 1, 0],
      // Per RFC-001, dimensions are in grid steps, not pixels. Height maps to the
      // host's widget sizes: 1 = small, 2 = medium, 4 = large. Height 0 paired with
      // width 2 is the horizontal size (it disambiguates "horizontal only" from
      // "medium and horizontal"). The Host picks one per layout.
      dimensions: { height: [1, 2, 4, 0], width: 2 }
    }
  ]
})
