#!/usr/bin/env node
// Assembles the extension we actually load: upstream floccus (its Chrome manifest and build
// output, exactly as its release zip packs them) plus the side panel from custom/panel. Nothing
// under the repo root is modified, so upstream updates never conflict with this.
//
// Output: custom/dist/extension/ (load it with "Load unpacked").
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const CUSTOM = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(CUSTOM)
const OUT = join(CUSTOM, 'dist', 'extension')
const PANEL_BUILD = join(CUSTOM, 'panel', 'dist')

function fail(message) {
  console.error(`assemble: ${message}`)
  process.exit(1)
}

if (!existsSync(join(ROOT, 'dist/js/background-script.js'))) {
  fail('floccus is not built (dist/js/background-script.js missing). Run custom/build.sh.')
}
if (!existsSync(join(PANEL_BUILD, 'pages/panel.html')) || !existsSync(join(PANEL_BUILD, 'background/background.js'))) {
  fail('the panel is not built. Run custom/build.sh.')
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.chrome.json'), 'utf8'))

// The public key pins the extension id (lejbjdlcofjbakbejknhflmebefennom), so it stays the
// same wherever the folder is loaded from and floccus keeps its profiles across rebuilds.
manifest.key = readFileSync(join(CUSTOM, 'extension-key.txt'), 'utf8').trim()
manifest.name = `${manifest.name} (custom)`

const permissions = new Set(manifest.permissions)
for (const p of ['sidePanel', 'offscreen', 'favicon', 'contextMenus', 'scripting']) permissions.add(p)
manifest.permissions = [...permissions]
// captureVisibleTab (the page screenshots) accepts only <all_urls>, not floccus's *://*/*.
manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), '<all_urls>'])]

manifest.side_panel = { default_path: 'panel/panel.html' }

// The toolbar button opens the panel (panel background sets openPanelOnActionClick), which
// only works without a popup. Floccus's settings move to the button's right-click menu and the
// panel's settings button.
if (!manifest.action) fail('manifest.chrome.json has no "action" anymore; see custom/CHANGES.md.')
delete manifest.action.default_popup
manifest.action.default_title = 'Favoritos'
manifest.commands = {
  ...manifest.commands,
  _execute_action: { suggested_key: { default: 'Alt+Shift+B' }, description: 'Abrir o painel de favoritos' },
}

// SQLite runs as WebAssembly, which extension pages may only compile with 'wasm-unsafe-eval'.
const csp = manifest.content_security_policy?.extension_pages
if (!csp?.includes("script-src 'self'")) fail(`unexpected extension_pages CSP: ${csp}`)
if (!csp.includes('wasm-unsafe-eval')) {
  manifest.content_security_policy.extension_pages = csp.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'")
}

// One service worker per extension: ours loads floccus's, then the panel's. It sits next to
// floccus's script because floccus loads its chunks with paths relative to the worker.
const floccusWorker = manifest.background?.service_worker
if (floccusWorker !== 'dist/js/background-script.js') fail(`unexpected service worker: ${floccusWorker}`)
manifest.background.service_worker = 'dist/js/panel-sw.js'

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// Same file set as floccus's chromeZip task: dist/ without source maps and node tests.
const skip = (src) => src.endsWith('.map') || relative(ROOT, src).startsWith(join('dist', 'node-tests'))
cpSync(join(ROOT, 'dist'), join(OUT, 'dist'), { recursive: true, filter: (src) => !skip(src) })
cpSync(join(ROOT, 'icons'), join(OUT, 'icons'), { recursive: true })
cpSync(join(ROOT, '_locales'), join(OUT, '_locales'), { recursive: true })

cpSync(join(PANEL_BUILD, 'pages'), join(OUT, 'panel'), { recursive: true })
cpSync(join(PANEL_BUILD, 'background/background.js'), join(OUT, 'panel/background.js'))
writeFileSync(
  join(OUT, 'dist/js/panel-sw.js'),
  "importScripts('./background-script.js', '../../panel/background.js')\n",
)

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`assemble: ${relative(process.cwd(), OUT) || OUT} (floccus ${manifest.version})`)
