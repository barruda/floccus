// The service worker part. Floccus's own worker is a classic script, so ours is an IIFE that
// dist/js/panel-sw.js pulls in with importScripts() after floccus's background script.
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  build: {
    outDir: fileURLToPath(new URL('./dist/background', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome120',
    lib: {
      entry: fileURLToPath(new URL('./src/background/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'floccusPanelBackground',
      fileName: () => 'background.js',
    },
  },
})
