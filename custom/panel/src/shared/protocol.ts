// Messages between the panel, the service worker and the offscreen document. Everything goes
// through chrome.runtime messaging, tagged with CHANNEL so floccus's own listeners never see a
// message they would act on.
export const CHANNEL = 'floccus-panel'
export const OFFSCREEN_PATH = 'panel/offscreen.html'

// Everything we know about a page, keyed by URL rather than bookmark id: floccus may recreate a
// bookmark (new id) during a sync, while its URL stays the same.
export interface PageRow {
  url: string
  title: string | null
  description: string | null
  image: string | null
  site_name: string | null
  meta_fetched_at: number | null
  meta_error: string | null
  shot: string | null
  shot_at: number | null
  archived_at: number | null
  archive_source: 'tab' | 'fetch' | null
  archive_bytes: number | null
}

// The snippet marks each matched term with \u0002 … \u0003.
export interface ArchiveHit {
  url: string
  title: string | null
  snippet: string
}

export const MATCH_START = '\u0002'
export const MATCH_END = '\u0003'

export interface SavedPage {
  html: string
  archived_at: number
  source: 'tab' | 'fetch'
}

export type OffscreenRequest =
  | { op: 'pages.get'; urls: string[] }
  | { op: 'pages.fetchMeta'; url: string }
  | { op: 'shot.put'; url: string; dataUrl: string }
  | { op: 'archive.put'; url: string; html: string; title: string | null; source: 'tab' | 'fetch' }
  | { op: 'archive.fetch'; url: string }
  | { op: 'archive.get'; url: string }
  | { op: 'archive.delete'; url: string }
  | { op: 'archive.search'; query: string }

export interface OffscreenResults {
  'pages.get': PageRow[]
  'pages.fetchMeta': PageRow | null
  'shot.put': null
  'archive.put': null
  'archive.fetch': null
  'archive.get': SavedPage | null
  'archive.delete': null
  'archive.search': ArchiveHit[]
}

export type BackgroundRequest = { op: 'ensureOffscreen' }

export type Envelope =
  | ({ channel: typeof CHANNEL; target: 'offscreen' } & OffscreenRequest)
  | ({ channel: typeof CHANNEL; target: 'background' } & BackgroundRequest)
  | { channel: typeof CHANNEL; target: 'broadcast'; event: 'pages.changed'; urls: string[] }

export type Reply<T> = { result: T } | { error: string }

export function isEnvelope(msg: unknown): msg is Envelope {
  return typeof msg === 'object' && msg !== null && (msg as { channel?: unknown }).channel === CHANNEL
}
