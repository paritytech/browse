import { resolve } from 'path'

import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import preact from '@preact/preset-vite'

const target = process.env.VITE_BUILD_TARGET

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
  plugins: [preact(), nodePolyfills()],
  build: {
    target: 'es2022',
    rollupOptions: { input }
  }
})
