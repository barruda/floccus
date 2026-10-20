// The panel's tags: a local copy (instant, works offline) that syncs with tags.json on GitHub
// when the panel opens, a moment after each edit, and every few minutes while it is open.
import { reactive } from 'vue'
import { ConflictError, readTags, writeTags, type RepoConfig } from './github'
import { loadConfig } from './credentials'
import { emptyFile, mergeFiles, normalizeTag, normalizeTags, pruneTombstones, serialize, type TagFile } from './model'

const LOCAL_KEY = 'floccus-panel.tags'
const PUSH_DELAY = 1500
const PERIODIC_SYNC = 5 * 60 * 1000

interface LocalCopy {
  file: TagFile
  dirty: boolean
}

export const tagState = reactive({
  file: emptyFile(),
  dirty: false,
  status: 'idle' as 'idle' | 'syncing' | 'error' | 'unconfigured',
  error: '',
  lastSync: 0,
  config: null as RepoConfig | null,
})

export function tagsFor(url: string | undefined): string[] {
  return (url && tagState.file.entries[url]?.tags) || []
}

async function saveLocal() {
  const copy: LocalCopy = { file: tagState.file, dirty: tagState.dirty }
  await chrome.storage.local.set({ [LOCAL_KEY]: JSON.parse(JSON.stringify(copy)) })
}

function edit(change: (entries: TagFile['entries'], now: number) => void) {
  const now = Date.now()
  const entries = { ...tagState.file.entries }
  change(entries, now)
  tagState.file = { version: 1, entries }
  tagState.dirty = true
  saveLocal().catch(console.warn)
  scheduleSync(PUSH_DELAY)
}

export function setTags(url: string, tags: string[]) {
  edit((entries, now) => {
    entries[url] = { tags: normalizeTags(tags), updatedAt: now }
  })
}

// Renaming onto an existing tag merges the two.
export function renameTag(from: string, to: string) {
  const target = normalizeTag(to)
  if (!target || target === from) return
  edit((entries, now) => {
    for (const [url, entry] of Object.entries(entries)) {
      if (entry.tags.includes(from)) {
        entries[url] = { tags: normalizeTags(entry.tags.map((t) => (t === from ? target : t))), updatedAt: now }
      }
    }
  })
}

export function deleteTag(tag: string) {
  edit((entries, now) => {
    for (const [url, entry] of Object.entries(entries)) {
      if (entry.tags.includes(tag)) entries[url] = { tags: entry.tags.filter((t) => t !== tag), updatedAt: now }
    }
  })
}

let running: Promise<void> | null = null
let again = false
let timer: ReturnType<typeof setTimeout> | undefined

export function scheduleSync(delay = 0) {
  clearTimeout(timer)
  timer = setTimeout(() => void sync(), delay)
}

// One sync at a time; a request during a sync runs once more afterwards.
export function sync(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = syncOnce().finally(() => {
    running = null
    if (again) {
      again = false
      void sync()
    }
  })
  return running
}

async function syncOnce() {
  const result = await loadConfig()
  if ('error' in result) {
    tagState.config = null
    tagState.status = 'unconfigured'
    tagState.error = result.error
    return
  }
  const cfg = result.config
  tagState.config = cfg
  tagState.status = 'syncing'
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await readTags(cfg)
      const merged = pruneTombstones(remote ? mergeFiles(tagState.file, remote.file) : tagState.file)
      tagState.file = merged
      if (remote && serialize(merged) === serialize(remote.file)) break
      if (!remote && !Object.keys(merged.entries).length) break // nothing to store yet
      try {
        await writeTags(cfg, merged, remote?.sha ?? null)
        break
      } catch (err) {
        if (!(err instanceof ConflictError) || attempt === 3) throw err
      }
    }
    tagState.dirty = false
    tagState.status = 'idle'
    tagState.error = ''
    tagState.lastSync = Date.now()
  } catch (err) {
    tagState.status = 'error'
    tagState.error = String((err as Error)?.message ?? err)
  }
  await saveLocal()
}

let started = false

export async function startTags() {
  if (started) return
  started = true
  const stored = (await chrome.storage.local.get(LOCAL_KEY))[LOCAL_KEY] as LocalCopy | undefined
  if (stored?.file) {
    tagState.file = stored.file
    tagState.dirty = stored.dirty
  }
  // The panel can be open in several windows; each keeps the others' edits.
  chrome.storage.local.onChanged.addListener((changes) => {
    const copy = changes[LOCAL_KEY]?.newValue as LocalCopy | undefined
    if (copy?.file) tagState.file = mergeFiles(tagState.file, copy.file)
  })
  setInterval(() => void sync(), PERIODIC_SYNC)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync()
  })
  await sync()
}
