import { resolve } from 'path'

import { defineConfig, type Plugin } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import preact from '@preact/preset-vite'

const target = process.env.APP_BUILD_TARGET

// A local `truapi-host dev` stands in for a real Host by serving a bridge script
// the page must load before any app code. Only the dev server injects it, so a
// production build never carries the tag.
// The truapi-host container turns built-in prototype methods into `() => value`
// getters. get-intrinsic, under the util polyfill, returns such a getter as the
// intrinsic unless it carries `originalValue`, so the app crashes on load. Remove
// once host-rust-core js/container marks its own getters.
const MARK_CONTAINER_GETTERS = `
for (const proto of [String.prototype, Array.prototype, Map.prototype, WeakMap.prototype,
  Set.prototype, Promise.prototype, Uint8Array.prototype, DataView.prototype,
  MessagePort.prototype, EventTarget.prototype, TextEncoder.prototype, TextDecoder.prototype,
  Object.getPrototypeOf(Uint8Array.prototype), Object.getPrototypeOf(Uint8Array),
  Object.getPrototypeOf([][Symbol.iterator]()),
  Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),
  Object.getPrototypeOf(new Map()[Symbol.iterator]()),
  Object.getPrototypeOf(new Set()[Symbol.iterator]())]) {
  for (const key of Reflect.ownKeys(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, key)
    if (!d || !d.get || 'originalValue' in d.get) continue
    if (Function.prototype.toString.call(d.get).includes('[native code]')) continue
    try { d.get.originalValue = d.get.call(proto) } catch {}
  }
}`

function truapiHostBridge(): Plugin {
  const port = process.env.APP_TRUAPI_BRIDGE_PORT
  return {
    name: 'truapi-host-bridge',
    apply: 'serve',
    transformIndexHtml: () =>
      port
        ? [
            {
              tag: 'script',
              attrs: { src: `http://127.0.0.1:${port}/bootstrap.js` },
              injectTo: 'head-prepend'
            },
            { tag: 'script', children: MARK_CONTAINER_GETTERS, injectTo: 'head-prepend' }
          ]
        : []
  }
}

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
  plugins: [truapiHostBridge(), preact(), nodePolyfills()],
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
