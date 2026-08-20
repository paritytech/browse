import { defineConfig } from 'bulletin-deploy'

export default defineConfig({
  domain: 'calculator.test',
  displayName: 'Calculator',
  description: 'Yes. A calculator. Cool right?',
  icon: { path: './icon.png', format: 'png' },
  executables: [
    {
      kind: 'app',
      path: './dist',
      appVersion: [0, 1, 0]
    }
  ]
})
