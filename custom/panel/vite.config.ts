// Builds the extension pages: the side panel, the offscreen document that owns the SQLite
// database, and the viewer for saved pages. assemble.mjs copies the output to panel/ in the
// extension, so every path stays relative (base './').
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const src = (file: string) => fileURLToPath(new URL(`./src/${file}`, import.meta.url))

export default defineConfig({
  root: src(''),
  base: './',
  plugins: [vue()],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('./dist/pages', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome120',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        panel: src('panel.html'),
        offscreen: src('offscreen.html'),
        viewer: src('viewer.html'),
      },
    },
  },
})
