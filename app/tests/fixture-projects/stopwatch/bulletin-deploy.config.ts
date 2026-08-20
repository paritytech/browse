import { defineConfig } from 'bulletin-deploy'

export default defineConfig({
  domain: 'stopwatch.test',
  displayName: 'Stopwatch',
  description: 'Really? Yes. Someone had to.',
  icon: { path: './icon.png', format: 'png' },
  executables: [
    {
      kind: 'app',
      path: './dist',
      appVersion: [0, 1, 0]
    }
  ]
})
