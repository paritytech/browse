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
      // Per the RFC-001, dimensions are in grid steps, not pixels.
      // This widget renders at heights 2, 4, and 8 rows (small, medium, large)
      // and the Host picks one per layout. Width is 1, the single grid column
      // the RFC treats as the default.
      dimensions: { height: [2, 4, 8], width: 1 }
    }
  ]
})
