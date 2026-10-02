import { defineConfig } from 'bulletin-deploy'

export default defineConfig({
  domain: 'countdown-timer.testnet',
  displayName: 'Countdown Timer',
  description: 'Counts down. Then stops. That is the whole pitch.',
  icon: { path: './icon.png', format: 'png' },
  executables: [
    {
      kind: 'app',
      path: './dist',
      appVersion: [0, 1, 0]
    }
  ]
})
