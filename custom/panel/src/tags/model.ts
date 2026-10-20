// The tag file: tags per page URL, stored as tags.json on the `panel` branch of the bookmarks
// repository (see custom/README.md, "Tags"). Keyed by URL like the rest of the panel's data,
// because bookmark ids differ between browsers and change when floccus recreates a bookmark.
export interface TagEntry {
  tags: string[]
  // Last change, in ms. Merging keeps the newer entry per URL; an entry whose tags were all
  // removed stays as a tombstone so the removal reaches the other browsers.
  updatedAt: number
}

export interface TagFile {
  version: 1
  entries: Record<string, TagEntry>
}

const TOMBSTONE_MAX_AGE = 180 * 24 * 60 * 60 * 1000

export const emptyFile = (): TagFile => ({ version: 1, entries: {} })

// "#Ler depois" -> "ler-depois"
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().replace(/\s+/g, '-').toLowerCase()
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))].sort()
}

export function mergeFiles(local: TagFile, remote: TagFile): TagFile {
  const entries: Record<string, TagEntry> = { ...remote.entries }
  for (const [url, entry] of Object.entries(local.entries)) {
    const other = entries[url]
    if (!other || entry.updatedAt > other.updatedAt) entries[url] = entry
  }
  return { version: 1, entries }
}

export function pruneTombstones(file: TagFile, now = Date.now()): TagFile {
  const entries = Object.fromEntries(
    Object.entries(file.entries).filter(([, e]) => e.tags.length || now - e.updatedAt < TOMBSTONE_MAX_AGE),
  )
  return { version: 1, entries }
}

// Stable output (sorted URLs and tags, indented) so commits on GitHub show readable diffs and
// equal content always serializes the same.
export function serialize(file: TagFile): string {
  const entries = Object.fromEntries(
    Object.keys(file.entries)
      .sort()
      .map((url) => [url, { tags: [...file.entries[url].tags].sort(), updatedAt: file.entries[url].updatedAt }]),
  )
  return JSON.stringify({ version: 1, entries }, null, 2) + '\n'
}

export function parse(text: string): TagFile {
  const data = JSON.parse(text)
  if (data?.version !== 1 || typeof data.entries !== 'object') throw new Error('tags.json has an unknown format')
  return { version: 1, entries: data.entries }
}

// A search query mixes #tags and free text: "#receitas pão".
export function parseQuery(query: string): { tags: string[]; text: string } {
  const tags: string[] = []
  const words: string[] = []
  for (const token of query.split(/\s+/).filter(Boolean)) {
    if (token.startsWith('#') && token.length > 1) tags.push(normalizeTag(token))
    else words.push(token)
  }
  return { tags, text: words.join(' ') }
}

export function toggleTagInQuery(query: string, tag: string): string {
  const { tags } = parseQuery(query)
  const tokens = query.split(/\s+/).filter(Boolean)
  const next = tags.includes(tag)
    ? tokens.filter((t) => !(t.startsWith('#') && normalizeTag(t) === tag))
    : [...tokens, `#${tag}`]
  return next.join(' ') + (next.length ? ' ' : '')
}

// A stable hue per tag, so a tag has the same color everywhere.
export function tagHue(tag: string): number {
  let h = 7
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
