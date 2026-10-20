// The offscreen document: the one place that talks to the database worker. It also fetches
// pages (the extension's host permissions let it read any site) to pull their preview metadata
// and to save their HTML.
import {
  CHANNEL,
  isEnvelope,
  type ArchiveHit,
  type OffscreenRequest,
  type OffscreenResults,
  type PageRow,
  type SavedPage,
} from '../shared/protocol'
import type { Statement, WorkerReply, WorkerRequest } from './db.worker'

const FETCH_TIMEOUT = 15_000
const SHOT_WIDTH = 640
const SHOT_HEIGHT = 400
const MAX_BODY_TEXT = 200_000

const worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' })
const pending = new Map<number, { resolve: (rows: Record<string, unknown>[]) => void; reject: (e: Error) => void }>()
let nextId = 1

worker.onmessage = (event: MessageEvent<WorkerReply>) => {
  const reply = event.data
  const call = pending.get(reply.id)
  if (!call) return
  pending.delete(reply.id)
  if ('error' in reply) call.reject(new Error(reply.error))
  else call.resolve(reply.rows)
}

function run<T = Record<string, unknown>>(...statements: Statement[]): Promise<T[]> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (rows: Record<string, unknown>[]) => void, reject })
    worker.postMessage({ id, statements } satisfies WorkerRequest)
  })
}

function broadcastChanged(urls: string[]) {
  chrome.runtime
    .sendMessage({ channel: CHANNEL, target: 'broadcast', event: 'pages.changed', urls })
    .catch(() => {}) // nobody listening: the panel is closed
}

async function getPages(urls: string[]): Promise<PageRow[]> {
  if (!urls.length) return []
  const rows: PageRow[] = []
  // SQLite caps bound parameters per statement, so query in chunks.
  for (let i = 0; i < urls.length; i += 500) {
    const chunk = urls.slice(i, i + 500)
    rows.push(
      ...(await run<PageRow>({
        sql: `SELECT * FROM pages WHERE url IN (${chunk.map(() => '?').join(',')})`,
        bind: chunk,
      })),
    )
  }
  return rows
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('html')) throw new Error(`Not an HTML page (${type || 'no content type'})`)
    return { html: await res.text(), finalUrl: res.url || url }
  } finally {
    clearTimeout(timer)
  }
}

function readMeta(doc: Document, baseUrl: string) {
  const meta = (...names: string[]) => {
    for (const name of names) {
      const el = doc.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)
      const value = el?.content?.trim()
      if (value) return value
    }
    return null
  }
  const absolute = (value: string | null) => {
    if (!value) return null
    try {
      return new URL(value, baseUrl).href
    } catch {
      return null
    }
  }
  return {
    title: meta('og:title', 'twitter:title') ?? (doc.title.trim() || null),
    description: meta('og:description', 'twitter:description', 'description'),
    image: absolute(
      meta('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src') ??
        doc.querySelector<HTMLLinkElement>('link[rel="image_src"]')?.getAttribute('href') ??
        null,
    ),
    site_name: meta('og:site_name', 'application-name'),
  }
}

function metaStatement(url: string, meta: ReturnType<typeof readMeta>): Statement {
  return {
    sql: `INSERT INTO pages (url, title, description, image, site_name, meta_fetched_at, meta_error)
          VALUES (?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(url) DO UPDATE SET title = excluded.title, description = excluded.description,
            image = excluded.image, site_name = excluded.site_name,
            meta_fetched_at = excluded.meta_fetched_at, meta_error = NULL`,
    bind: [url, meta.title, meta.description, meta.image, meta.site_name, Date.now()],
  }
}

async function fetchMeta(url: string): Promise<PageRow | null> {
  try {
    const { html, finalUrl } = await fetchPage(url)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    await run(metaStatement(url, readMeta(doc, finalUrl)))
  } catch (err) {
    await run({
      sql: `INSERT INTO pages (url, meta_fetched_at, meta_error) VALUES (?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET meta_fetched_at = excluded.meta_fetched_at,
              meta_error = excluded.meta_error`,
      bind: [url, Date.now(), String((err as Error)?.message ?? err)],
    })
  }
  const [row] = await getPages([url])
  return row ?? null
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Shrinks the screenshot to a card-sized WebP, cropped from the top of the page.
async function putShot(url: string, dataUrl: string) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const scale = SHOT_WIDTH / bitmap.width
  const sourceHeight = Math.min(bitmap.height, SHOT_HEIGHT / scale)
  const canvas = new OffscreenCanvas(SHOT_WIDTH, Math.round(sourceHeight * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, bitmap.width, sourceHeight, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const shot = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/webp', quality: 0.75 }))
  await run({
    sql: `INSERT INTO pages (url, shot, shot_at) VALUES (?, ?, ?)
          ON CONFLICT(url) DO UPDATE SET shot = excluded.shot, shot_at = excluded.shot_at`,
    bind: [url, shot, Date.now()],
  })
  broadcastChanged([url])
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

const BLOCKS = 'address, article, aside, blockquote, br, dd, div, dl, dt, figcaption, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, td, th, tr, ul'

function pageText(doc: Document): string {
  doc.querySelectorAll('script, style, noscript, template, svg').forEach((el) => el.remove())
  // A parsed document has no layout, so textContent glues "<h1>Title</h1><p>Text" into
  // "TitleText". A space after each block keeps the words apart for the full-text index.
  doc.querySelectorAll(BLOCKS).forEach((el) => el.after(' '))
  return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_BODY_TEXT)
}

// Saved pages keep working offline-ish: a <base> makes their relative links, styles and
// images point at the original site.
function withBase(html: string, url: string): string {
  const base = `<base href="${url.replace(/"/g, '&quot;')}">`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (head) => head + base)
  return base + html
}

async function putArchive(url: string, rawHtml: string, title: string | null, source: 'tab' | 'fetch') {
  const html = withBase(rawHtml, url)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const meta = readMeta(doc, url)
  const text = pageText(doc)
  const gz = await gzip(html)
  const pageTitle = title || meta.title
  await run(
    metaStatement(url, meta),
    { sql: 'INSERT OR REPLACE INTO archives (url, html_gz) VALUES (?, ?)', bind: [url, gz] },
    { sql: 'DELETE FROM archive_fts WHERE url = ?', bind: [url] },
    { sql: 'INSERT INTO archive_fts (url, title, body) VALUES (?, ?, ?)', bind: [url, pageTitle, text] },
    {
      sql: 'UPDATE pages SET archived_at = ?, archive_source = ?, archive_bytes = ? WHERE url = ?',
      bind: [Date.now(), source, gz.byteLength, url],
    },
  )
  broadcastChanged([url])
}

async function getArchive(url: string): Promise<SavedPage | null> {
  const [row] = await run<{ html_gz: Uint8Array; archived_at: number; archive_source: 'tab' | 'fetch' }>({
    sql: `SELECT a.html_gz, p.archived_at, p.archive_source
          FROM archives a JOIN pages p ON p.url = a.url WHERE a.url = ?`,
    bind: [url],
  })
  if (!row) return null
  return { html: await gunzip(row.html_gz), archived_at: row.archived_at, source: row.archive_source }
}

// Every word must appear, each as a prefix, so "flo sync" finds "floccus synchronization".
function ftsQuery(query: string): string | null {
  const terms = query.split(/\s+/).filter(Boolean)
  if (!terms.length) return null
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}

async function searchArchives(query: string): Promise<ArchiveHit[]> {
  const match = ftsQuery(query)
  if (!match) return []
  return run<ArchiveHit>({
    sql: `SELECT url, title, snippet(archive_fts, 2, char(2), char(3), '…', 14) AS snippet
          FROM archive_fts WHERE archive_fts MATCH ? ORDER BY rank LIMIT 40`,
    bind: [match],
  })
}

const handlers: { [K in OffscreenRequest['op']]: (req: Extract<OffscreenRequest, { op: K }>) => Promise<OffscreenResults[K]> } = {
  'pages.get': (req) => getPages(req.urls),
  'pages.fetchMeta': (req) => fetchMeta(req.url),
  'shot.put': async (req) => (await putShot(req.url, req.dataUrl), null),
  'archive.put': async (req) => (await putArchive(req.url, req.html, req.title, req.source), null),
  'archive.fetch': async (req) => {
    const { html } = await fetchPage(req.url)
    await putArchive(req.url, html, null, 'fetch')
    return null
  },
  'archive.get': (req) => getArchive(req.url),
  'archive.delete': async (req) => {
    await run(
      { sql: 'DELETE FROM archives WHERE url = ?', bind: [req.url] },
      { sql: 'DELETE FROM archive_fts WHERE url = ?', bind: [req.url] },
      {
        sql: 'UPDATE pages SET archived_at = NULL, archive_source = NULL, archive_bytes = NULL WHERE url = ?',
        bind: [req.url],
      },
    )
    broadcastChanged([req.url])
    return null
  },
  'archive.search': (req) => searchArchives(req.query),
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isEnvelope(msg) || msg.target !== 'offscreen') return false
  const handler = handlers[msg.op] as (req: OffscreenRequest) => Promise<unknown>
  handler(msg).then(
    (result) => sendResponse({ result }),
    (err) => sendResponse({ error: String(err?.message ?? err) }),
  )
  return true
})
