import { defineConfig } from 'bulletin-deploy'

export default defineConfig({
  domain: 'browse.dot',
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
