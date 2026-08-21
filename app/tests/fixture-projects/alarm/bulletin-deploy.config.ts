import { defineConfig } from 'bulletin-deploy'

export default defineConfig({
  domain: 'alarm-clock.test',
  displayName: 'Alarm Clock',
  description: 'Wakes you up. Nothing else on its mind.',
  icon: { path: './icon.png', format: 'png' },
  executables: [
    {
      kind: 'app',
      path: './dist',
      appVersion: [0, 1, 0]
    }
  ]
})
