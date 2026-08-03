import { resolve } from 'path'

import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import preact from '@preact/preset-vite'

export default defineConfig({
  // Load env from the repo root .env, shared with the store, evm, and deploy.
  envDir: resolve(__dirname, '../..'),
  // Expose APP_* and NETWORK_* env to the client bundle.
  envPrefix: ['APP_', 'NETWORK_'],
  plugins: [preact(), nodePolyfills()],
  resolve: {
    alias: {
      '@parity/browse-sdk': resolve(__dirname, '../../packages/browse-sdk/src/index.ts')
    }
  },
  build: {
    target: 'es2022'
  }
})
