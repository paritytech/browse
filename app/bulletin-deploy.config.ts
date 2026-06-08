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
      dimensions: { height: [400], width: 360 }
    }
  ]
})
