import { defineConfig } from 'bulletin-deploy'

export default defineConfig({
  domain: 'unit-converter.testnet',
  displayName: 'Unit Converter',
  description: 'Metres to feet, and back again.',
  icon: { path: './icon.png', format: 'png' },
  executables: [
    {
      kind: 'app',
      path: './dist',
      appVersion: [0, 1, 0]
    }
  ]
})
