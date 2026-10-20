<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import BookmarkItem from './BookmarkItem.vue'
import FolderItem from './FolderItem.vue'
import Icon from './Icon.vue'
import {
  BOOKMARKS_BAR_ID,
  ROOT_ID,
  bookmarksForUrls,
  folderExists,
  getFolder,
  getPath,
  onBookmarksChanged,
  searchBookmarks,
  type BookmarkNode,
  type FolderEntry,
} from './bookmarks'
import { loadPages, savePage, toasts } from './pages'
import { offscreen } from '../shared/rpc'

type Mode = 'grid' | 'list'

// Per-viewer conveniences only; the panel works the same without them.
function remember(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`floccus-panel.${key}`) ?? fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(`floccus-panel.${key}`, value)
  } catch {
    /* storage unavailable */
  }
}

const mode = ref<Mode>(remember('mode', 'grid') === 'list' ? 'list' : 'grid')
const folderId = ref(remember('folder', BOOKMARKS_BAR_ID))
const path = ref<BookmarkNode[]>([])
const folders = ref<FolderEntry[]>([])
const bookmarks = ref<BookmarkNode[]>([])
const loading = ref(true)

const query = ref('')
const searchBox = ref<HTMLInputElement>()
const results = ref<BookmarkNode[]>([])
const savedHits = ref<{ bookmark: BookmarkNode; snippet: string }[]>([])
const searching = computed(() => query.value.trim().length > 0)

watch(mode, (m) => store('mode', m))
watch(folderId, (id) => store('folder', id))

async function loadFolder() {
  if (!(await folderExists(folderId.value))) folderId.value = BOOKMARKS_BAR_ID
  const [content, crumbs] = await Promise.all([getFolder(folderId.value), getPath(folderId.value)])
  folders.value = content.folders
  bookmarks.value = content.bookmarks
  path.value = crumbs
  loading.value = false
  if (!searching.value) loadPages(content.bookmarks.map((b) => b.url!)).catch(console.warn)
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchRun = 0

async function runSearch() {
  const q = query.value.trim()
  const run = ++searchRun
  const [found, hits] = await Promise.all([
    searchBookmarks(q),
    offscreen({ op: 'archive.search', query: q }).catch(() => []),
  ])
  const hitBookmarks = await bookmarksForUrls(hits.map((h) => h.url))
  if (run !== searchRun) return
  results.value = found
  savedHits.value = hitBookmarks.map((bookmark) => ({
    bookmark,
    snippet: hits.find((h) => h.url === bookmark.url)?.snippet ?? '',
  }))
  loadPages([...found, ...hitBookmarks].map((b) => b.url!)).catch(console.warn)
}

watch(query, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) {
    loadFolder()
    return
  }
  searchTimer = setTimeout(runSearch, 180)
})

function openFolder(id: string) {
  query.value = ''
  folderId.value = id
}
watch(folderId, loadFolder)

const folderTitle = computed(() => path.value.at(-1)?.title || 'Favoritos')
const savingAll = ref(false)

async function saveAll() {
  savingAll.value = true
  try {
    for (const b of bookmarks.value) {
      if (b.url?.startsWith('http')) await savePage(b.url, b.title || null)
    }
  } finally {
    savingAll.value = false
  }
}

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dist/html/options.html') })
}

function onKey(event: KeyboardEvent) {
  const typing = document.activeElement === searchBox.value
  if (event.key === '/' && !typing) {
    event.preventDefault()
    searchBox.value?.focus()
  } else if (event.key === 'Escape' && typing) {
    query.value = ''
    searchBox.value?.blur()
  }
}

let stopListening: (() => void) | undefined
onMounted(() => {
  loadFolder()
  stopListening = onBookmarksChanged(() => (searching.value ? runSearch() : loadFolder()))
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  stopListening?.()
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <header class="top">
    <div class="row">
      <nav class="crumbs" aria-label="Pastas">
        <button class="crumb home" title="Todas as pastas" @click="openFolder(ROOT_ID)">
          <Icon name="home" />
        </button>
        <template v-for="(node, i) in path" :key="node.id">
          <Icon name="chevron" :size="14" class="sep" />
          <button class="crumb" :class="{ current: i === path.length - 1 }" @click="openFolder(node.id)">
            {{ node.title || 'Sem nome' }}
          </button>
        </template>
      </nav>
      <div class="tools">
        <div class="segmented" role="group" aria-label="Visualização">
          <button :class="{ on: mode === 'grid' }" title="Grade" @click="mode = 'grid'"><Icon name="grid" /></button>
          <button :class="{ on: mode === 'list' }" title="Lista" @click="mode = 'list'"><Icon name="list" /></button>
        </div>
        <button class="icon-button" title="Configurações de sincronização (floccus)" @click="openSettings">
          <Icon name="settings" />
        </button>
      </div>
    </div>
    <label class="search">
      <Icon name="search" />
      <input ref="searchBox" v-model="query" type="search" placeholder="Buscar nos favoritos e páginas salvas  /" />
      <button v-if="query" class="icon-button" title="Limpar" @click="query = ''"><Icon name="x" /></button>
    </label>
  </header>

  <main>
    <template v-if="searching">
      <section>
        <h2>Favoritos <span class="count">{{ results.length }}</span></h2>
        <div :class="['items', mode]">
          <BookmarkItem v-for="b in results" :key="b.id" :bookmark="b" :mode="mode" />
        </div>
        <p v-if="!results.length" class="empty">
          {{ savedHits.length ? 'Nenhum título ou endereço bate com a busca.' : 'Nada encontrado.' }}
        </p>
      </section>
      <section v-if="savedHits.length">
        <h2>No conteúdo salvo <span class="count">{{ savedHits.length }}</span></h2>
        <div class="items list">
          <BookmarkItem
            v-for="hit in savedHits"
            :key="hit.bookmark.id"
            :bookmark="hit.bookmark"
            mode="list"
            :snippet="hit.snippet"
          />
        </div>
      </section>
    </template>

    <template v-else-if="!loading">
      <div class="folder-head">
        <h1>{{ folderTitle }}</h1>
        <button v-if="bookmarks.length" class="text-button" :disabled="savingAll" @click="saveAll">
          <Icon :name="savingAll ? 'spinner' : 'save'" :size="14" />
          {{ savingAll ? 'Salvando…' : 'Salvar HTML de todos' }}
        </button>
      </div>
      <div v-if="folders.length" :class="['folders', mode]">
        <FolderItem v-for="f in folders" :key="f.node.id" :folder="f" :mode="mode" @open="openFolder" />
      </div>
      <div v-if="bookmarks.length" :class="['items', mode]">
        <BookmarkItem v-for="b in bookmarks" :key="b.id" :bookmark="b" :mode="mode" />
      </div>
      <p v-if="!folders.length && !bookmarks.length" class="empty">Pasta vazia.</p>
    </template>
  </main>

  <div class="toasts" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast">{{ t.text }}</div>
  </div>
</template>
