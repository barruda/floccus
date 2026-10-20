#!/usr/bin/env node
// End-to-end check of the assembled extension in a throwaway headless Brave/Chrome profile:
// floccus's settings page still loads, and the panel lists bookmarks, fetches previews, takes
// screenshots, saves HTML, finds it by content and shows it in the viewer.
//
// Usage: node custom/smoke-test.mjs [--browser /path/to/brave] [--screenshots <dir>]
// Needs custom/dist/extension (custom/build.sh). Never touches the user's browser profiles.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSION_ID = 'lejbjdlcofjbakbejknhflmebefennom'
const CUSTOM = dirname(fileURLToPath(import.meta.url))
const EXTENSION = join(CUSTOM, 'dist', 'extension')
const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const BROWSER = argValue('--browser', '/opt/brave.com/brave/brave')
const SHOTS = argValue('--screenshots', null)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(ok, what) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`)
  if (!ok) failures++
}

// Two small sites with Open Graph tags, served locally.
const page = (n, color, words) => `<!doctype html><html><head><title>Página ${n}</title>
<meta property="og:title" content="Página de teste ${n}">
<meta property="og:description" content="Descrição da página ${n}">
<meta property="og:image" content="/og${n}.svg"></head>
<body style="background:${color};font:40px sans-serif"><h1>Página ${n}</h1><p>${words}</p></body></html>`
const og = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="100%" height="100%" fill="${color}"/></svg>`
const server = createServer((req, res) => {
  const routes = {
    '/one': ['text/html', page(1, '#fde68a', 'abacaxi tropical')],
    '/two': ['text/html', page(2, '#bfdbfe', 'zebra listrada')],
    '/og1.svg': ['image/svg+xml', og('#f59e0b')],
    '/og2.svg': ['image/svg+xml', og('#3b82f6')],
  }
  const route = routes[req.url]
  res.writeHead(route ? 200 : 404, { 'content-type': `${route?.[0] ?? 'text/plain'}; charset=utf-8` })
  res.end(route?.[1] ?? 'not found')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const SITE = `http://127.0.0.1:${server.address().port}`

const profile = mkdtempSync(join(tmpdir(), 'floccus-smoke-'))
const port = 9300 + Math.floor(Math.random() * 500)
const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    // Branded Chromium builds ignore --load-extension unless this feature is off.
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--load-extension=${EXTENSION}`,
    '--no-first-run',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function targets() {
  for (let i = 0; i < 50; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    } catch {
      await sleep(200)
    }
  }
  throw new Error('browser did not start')
}

async function attach(match) {
  for (let i = 0; i < 50; i++) {
    const t = (await targets()).find((t) => t.url.includes(match))
    if (t) {
      const ws = new WebSocket(t.webSocketDebuggerUrl)
      await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
      let id = 0
      const waiting = new Map()
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data)
        waiting.get(d.id)?.(d)
        waiting.delete(d.id)
      }
      const send = (method, params = {}) =>
        new Promise((r) => {
          waiting.set(++id, r)
          ws.send(JSON.stringify({ id, method, params }))
        })
      const evaluate = async (expression) => {
        const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        if (d.result?.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails))
        return d.result?.result?.value
      }
      return { send, evaluate, close: () => ws.close() }
    }
    await sleep(200)
  }
  throw new Error(`no target matching ${match}`)
}

async function until(fn, what, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try {
      if (await fn()) return true
    } catch {
      /* not there yet */
    }
    await sleep(250)
  }
  console.log(`  (timed out waiting for ${what})`)
  return false
}

async function openTab(url) {
  const browserWs = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl
  const ws = new WebSocket(browserWs)
  await new Promise((r) => (ws.onopen = r))
  ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url } }))
  await new Promise((r) => (ws.onmessage = r))
  ws.close()
  return attach(url)
}

async function screenshot(target, name, width, height) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await target.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  const { result } = await target.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(result.data, 'base64'))
}

try {
  await attach(`${EXTENSION_ID}/dist/js/panel-sw.js`)
  check(true, 'service worker started (floccus + panel)')
  // DevTools evaluates in the worker without extension APIs, so API calls run in a page.
  const helper = await openTab(`chrome-extension://${EXTENSION_ID}/panel/viewer.html`)
  check(await helper.evaluate('typeof chrome.sidePanel.open === "function"'), 'side panel API available')
  check(
    await helper.evaluate(`chrome.runtime.getManifest().side_panel.default_path === 'panel/panel.html'`),
    'manifest declares the side panel',
  )

  await helper.evaluate(`(async () => {
    const folder = await chrome.bookmarks.create({ parentId: '1', title: 'Pasta de teste' })
    await chrome.bookmarks.create({ parentId: folder.id, title: 'Dentro da pasta', url: '${SITE}/two' })
    await chrome.bookmarks.create({ parentId: '1', title: 'Página um', url: '${SITE}/one' })
    await chrome.bookmarks.create({ parentId: '1', title: 'Página dois', url: '${SITE}/two' })
  })()`)
  helper.close()

  const options = await openTab(`chrome-extension://${EXTENSION_ID}/dist/html/options.html`)
  check(
    await until(() => options.evaluate('document.body.innerText.length > 20'), 'floccus options'),
    'floccus settings page still renders',
  )
  options.close()

  // A visit to a bookmarked page should leave a screenshot behind.
  const site = await openTab(`${SITE}/one`)
  const panel = await openTab(`chrome-extension://${EXTENSION_ID}/panel/panel.html`)
  await site.send('Page.bringToFront')
  check(
    await until(
      () =>
        panel.evaluate(`(async () => {
          const reply = await chrome.runtime.sendMessage({ channel: 'floccus-panel', target: 'offscreen', op: 'pages.get', urls: ['${SITE}/one'] })
          return !!reply?.result?.[0]?.shot
        })()`),
      'screenshot',
      20000,
    ),
    'screenshot of a visited bookmarked page stored',
  )
  await panel.send('Page.bringToFront')

  check(
    await until(() => panel.evaluate('document.querySelectorAll(".item").length === 2'), 'bookmarks'),
    'panel lists the bookmarks of the bookmarks bar',
  )
  check(await panel.evaluate('document.querySelectorAll(".folder").length === 1'), 'panel lists the subfolder')
  check(
    await until(
      () => panel.evaluate(`[...document.querySelectorAll('.item .shot')].some(i => i.src.endsWith('/og2.svg'))`),
      'og:image preview',
    ),
    'preview image from og:image shown',
  )
  await screenshot(panel, 'panel-grid', 420, 760)

  await panel.evaluate(`document.querySelector('.item[href$="/two"] .actions button').click()`)
  check(
    await until(() => panel.evaluate(`!!document.querySelector('.item[href$="/two"] .badge')`), 'saved badge'),
    'Salvar HTML marks the bookmark as saved',
  )

  await panel.evaluate(`(() => {
    const input = document.querySelector('.search input')
    input.value = 'listrada'
    input.dispatchEvent(new Event('input'))
  })()`)
  check(
    await until(
      () => panel.evaluate(`[...document.querySelectorAll('h2')].some(h => h.textContent.includes('No conteúdo salvo'))`),
      'content search',
    ),
    'search finds the saved page by its content',
  )
  await screenshot(panel, 'panel-search', 420, 760)

  await panel.evaluate(`(() => {
    const input = document.querySelector('.search input')
    input.value = ''
    input.dispatchEvent(new Event('input'))
    document.querySelectorAll('.segmented button')[1].click()
  })()`)
  await until(() => panel.evaluate('!!document.querySelector(".items.list")'), 'list mode')
  await screenshot(panel, 'panel-list', 420, 760)

  await panel.evaluate(`document.querySelector('.folder').click()`)
  check(
    await until(() => panel.evaluate(`document.querySelector('h1')?.textContent === 'Pasta de teste'`), 'subfolder'),
    'opening a folder shows its bookmarks',
  )

  const viewer = await openTab(
    `chrome-extension://${EXTENSION_ID}/panel/viewer.html?url=${encodeURIComponent(`${SITE}/two`)}`,
  )
  check(
    await until(() => viewer.evaluate(`document.getElementById('frame').srcdoc.includes('zebra listrada')`), 'viewer'),
    'viewer shows the saved HTML',
  )
  await screenshot(viewer, 'viewer', 900, 600)
} catch (err) {
  console.error(err)
  failures++
} finally {
  browser.kill()
  server.close()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
