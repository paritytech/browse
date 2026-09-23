import { resolve } from 'path'

import { defineConfig, type Plugin } from 'vite'
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

// Bridge to a local `truapi-host dev` signing host, so the dev server runs in a
// plain browser tab. It parks the host port synchronously, hence a blocking tag.
const truapiHostBridge: Plugin = {
  name: 'truapi-host-bridge',
  apply: 'serve',
  transformIndexHtml: () => [
    {
      tag: 'script',
      attrs: { src: 'http://127.0.0.1:9955/bootstrap.js' },
      injectTo: 'head-prepend'
    }
  ]
}

export default defineConfig({
  // Load env from the repo root .env, shared with evm and deploy.
  envDir: resolve(__dirname, '..'),
  // Expose APP_* and NETWORK_* env to the client bundle.
  envPrefix: ['APP_', 'NETWORK_'],
  plugins: [preact(), nodePolyfills(), truapiHostBridge],
  resolve: {
    alias: {
      // The subpath must precede the bare entry. Alias keys match by prefix, so
      // the bare one would otherwise swallow it and resolve to nothing.
      '@parity/browse-sdk/snapshots': resolve(__dirname, '../packages/browse-sdk/src/snapshots.ts'),
      '@parity/browse-sdk': resolve(__dirname, '../packages/browse-sdk/src/index.ts')
    }
  },
  build: {
    target: 'es2022',
    rollupOptions: { input }
  }
})
