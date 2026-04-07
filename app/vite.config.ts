import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact(), nodePolyfills()],
  build: {
    target: "es2022",
  },
});
