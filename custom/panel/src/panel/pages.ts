// What the panel knows about each page (preview metadata, screenshot, saved copy), mirrored
// from the database. Missing previews are fetched a few at a time, newest folder first.
import { reactive } from 'vue'
import { isEnvelope, type PageRow } from '../shared/protocol'
import { offscreen } from '../shared/rpc'

const META_MAX_AGE = 30 * 24 * 60 * 60 * 1000
const META_RETRY_AFTER_ERROR = 24 * 60 * 60 * 1000
const CONCURRENCY = 3

export const pages = reactive(new Map<string, PageRow>())
export const saving = reactive(new Set<string>())
export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export const toasts = reactive<Toast[]>([])

let toastId = 0
export function dismissToast(id: number) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

// A toast with an action (Desfazer) stays longer, to give time to reach the button.
export function toast(text: string, action?: Toast['action']) {
  const id = ++toastId
  toasts.push({ id, text, action })
  setTimeout(() => dismissToast(id), action ? 8000 : 4000)
  return id
}

async function refresh(urls: string[]) {
  const rows = await offscreen({ op: 'pages.get', urls })
  for (const row of rows) pages.set(row.url, row)
}

function needsMeta(row: PageRow | undefined): boolean {
  if (!row?.meta_fetched_at) return true
  const age = Date.now() - row.meta_fetched_at
  return row.meta_error ? age > META_RETRY_AFTER_ERROR : age > META_MAX_AGE
}

let queue: string[] = []
let running = 0

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const url = queue.shift()!
    running++
    offscreen({ op: 'pages.fetchMeta', url })
      .then((row) => row && pages.set(url, row))
      .catch((err) => console.debug('[floccus-panel] preview failed', url, err))
      .finally(() => {
        running--
        pump()
      })
  }
}

// Loads what the database has for these URLs and queues previews for the rest. A new call
// replaces the queue, so leaving a folder stops fetching its pages.
export async function loadPages(urls: string[]) {
  const httpUrls = urls.filter((u) => u.startsWith('http'))
  await refresh(httpUrls)
  queue = httpUrls.filter((url) => needsMeta(pages.get(url)))
  pump()
}

async function captureFromTab(url: string): Promise<string | null> {
  const strip = (u: string) => u.replace(/#.*$/, '')
  const tabs = await chrome.tabs.query({})
  const tab = tabs.find((t) => t.url && strip(t.url) === strip(url) && t.status === 'complete')
  if (tab?.id === undefined) return null
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => '<!doctype html>\n' + document.documentElement.outerHTML,
    })
    return typeof res?.result === 'string' ? res.result : null
  } catch {
    return null // pages the extension may not script (store, settings): fall back to a fetch
  }
}

// Saves the page's HTML. An open tab is preferred, since it has what the page rendered
// (logged-in content, client-side apps); otherwise the HTML is downloaded from the site.
export async function savePage(url: string, title: string | null) {
  if (saving.has(url)) return
  saving.add(url)
  try {
    const html = await captureFromTab(url)
    if (html) await offscreen({ op: 'archive.put', url, html, title, source: 'tab' })
    else await offscreen({ op: 'archive.fetch', url })
    await refresh([url])
  } catch (err) {
    toast(`Não deu para salvar ${url}: ${(err as Error).message}`)
  } finally {
    saving.delete(url)
  }
}

export function openSaved(url: string) {
  const viewer = new URL(chrome.runtime.getURL('panel/viewer.html'))
  viewer.searchParams.set('url', url)
  chrome.tabs.create({ url: viewer.href })
}

chrome.runtime.onMessage.addListener((msg) => {
  if (isEnvelope(msg) && msg.target === 'broadcast' && msg.event === 'pages.changed') {
    refresh(msg.urls).catch(console.debug)
  }
  return false
})
