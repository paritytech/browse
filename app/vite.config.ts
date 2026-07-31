import { resolve } from 'path'

import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import preact from '@preact/preset-vite'

const target = process.env.APP_BUILD_TARGET

const entries = {
  main: resolve(__dirname, 'index.html'),
  widget: resolve(__dirname, 'widget.html')
}

const input: Record<string, string> =
  target === 'spa'
    ? { main: entries.main }
    : target === 'widget'
      ? { widget: entries.widget }
      : entries

export default defineConfig({
  // Load env from the repo root .env, shared with evm and deploy.
  envDir: resolve(__dirname, '..'),
  // Expose APP_* and NETWORK_* env to the client bundle.
  envPrefix: ['APP_', 'NETWORK_'],
  plugins: [preact(), nodePolyfills()],
  resolve: {
    alias: {
      '@parity/browse-sdk': resolve(__dirname, '../packages/browse-sdk/src/index.ts'),
      // The subpath must precede the bare entry. Alias keys match by prefix, so
      // the bare one would otherwise swallow `/host` and resolve it to nothing.
      '@parity/browse-snapshots/host': resolve(__dirname, '../packages/snapshots/src/host.ts'),
      '@parity/browse-snapshots': resolve(__dirname, '../packages/snapshots/src/index.ts')
    }
  },
  build: {
    target: 'es2022',
    rollupOptions: { input }
  }
})
