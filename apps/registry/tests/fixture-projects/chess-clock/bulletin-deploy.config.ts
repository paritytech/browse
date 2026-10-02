import { defineConfig } from 'bulletin-deploy'

/**
 * The TLD comes from the environment because this fixture deploys to more than
 * one network, and dotNS registers the same label under a different TLD on
 * each. `MANIFEST_DOMAIN` follows the convention host-playground uses.
 */
export default defineConfig({
  domain: process.env.MANIFEST_DOMAIN ?? 'chess-clock.testnet',
  displayName: 'Chess Clock',
  description: 'Two clocks, one board. Tap to pass the turn.',
  icon: { path: './icon.png', format: 'png' },
  executables: [
    {
      kind: 'app',
      path: './dist',
      appVersion: [0, 1, 0]
    }
  ]
})
