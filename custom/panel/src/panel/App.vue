<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import BookmarkItem from './BookmarkItem.vue'
import FolderItem from './FolderItem.vue'
import Icon from './Icon.vue'
import TagChip from './TagChip.vue'
import TagEditor from './TagEditor.vue'
import TagManager from './TagManager.vue'
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
import { bookmarksWithTags, refreshLibrary, tagCounts } from './library'
import { dismissToast, loadPages, savePage, toasts } from './pages'
import { clearSelection, selectAll, selectedNodes, selection, setVisible } from './selection'
import { removeBookmarks, undo } from './trash'
import { SIZE_DEFAULT, toggleTagFilter, ui } from './ui'
import { offscreen } from '../shared/rpc'
import { parseQuery } from '../tags/model'
import { startTags, tagState } from '../tags/store'

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

const searchBox = ref<HTMLInputElement>()
const results = ref<BookmarkNode[]>([])
const savedHits = ref<{ bookmark: BookmarkNode; snippet: string }[]>([])
const searching = computed(() => ui.query.trim().length > 0)
const parsedQuery = computed(() => parseQuery(ui.query))

ui.size = Number(remember('size', String(SIZE_DEFAULT))) || SIZE_DEFAULT

watch(mode, (m) => store('mode', m))
watch(folderId, (id) => store('folder', id))
watch(
  () => ui.size,
  (size) => store('size', String(size)),
)

// One slider sizes both views: card width in the grid, thumbnail width in the list.
const sizeVars = computed(() => ({
  '--card-min': `${Math.round(120 + ui.size * 2.2)}px`,
  '--thumb': `${Math.round(48 + ui.size * 1.2)}px`,
}))

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

// "#receitas pão": bookmarks tagged #receitas whose title or URL has "pão", plus saved pages
// with "pão" in their text (also tagged #receitas). Tags alone list every bookmark carrying them.
async function runSearch() {
  const { tags, text } = parsedQuery.value
  const run = ++searchRun
  const [found, hits] = await Promise.all([
    text ? searchBookmarks(text) : Promise.resolve(undefined),
    text ? offscreen({ op: 'archive.search', query: text }).catch(() => []) : Promise.resolve([]),
  ])
  const hitBookmarks = bookmarksWithTags(tags, await bookmarksForUrls(hits.map((h) => h.url)))
  if (run !== searchRun) return
  results.value = tags.length || !found ? bookmarksWithTags(tags, found) : found
  savedHits.value = hitBookmarks.map((bookmark) => ({
    bookmark,
    snippet: hits.find((h) => h.url === bookmark.url)?.snippet ?? '',
  }))
  loadPages([...results.value, ...hitBookmarks].map((b) => b.url!)).catch(console.warn)
}

watch(
  () => ui.query,
  (q) => {
    clearTimeout(searchTimer)
    if (!q.trim()) {
      loadFolder()
      return
    }
    searchTimer = setTimeout(runSearch, 180)
  },
)

// Results follow tag edits made while a tag filter is showing.
watch(
  () => tagState.file,
  () => {
    if (searching.value && parsedQuery.value.tags.length) runSearch()
  },
)

// What is on screen, in order: the range for Shift+click and Ctrl+A.
setVisible(() => (searching.value ? [...results.value, ...savedHits.value.map((h) => h.bookmark)] : bookmarks.value))
watch([() => ui.query, folderId, () => ui.view], clearSelection)

const confirmingDelete = ref(false)
watch(() => selection.ids.size, (n) => n || (confirmingDelete.value = false))

async function deleteSelected() {
  const nodes = selectedNodes()
  confirmingDelete.value = false
  clearSelection()
  await removeBookmarks(nodes)
}

function openFolder(id: string) {
  ui.query = ''
  ui.view = 'browse'
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

// The tag strip: the tags in the current filter first, then the most used.
const stripTags = computed(() => {
  const active = parsedQuery.value.tags
  const rest = tagCounts.value.filter((t) => !active.includes(t.tag))
  return [...active.map((tag) => ({ tag, count: tagCounts.value.find((t) => t.tag === tag)?.count ?? 0 })), ...rest]
})

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dist/html/options.html') })
}

function onKey(event: KeyboardEvent) {
  if (ui.editing) return
  const typing = document.activeElement === searchBox.value
  const inInput = document.activeElement instanceof HTMLInputElement
  const mod = event.ctrlKey || event.metaKey
  if (event.key === '/' && !inInput) {
    event.preventDefault()
    searchBox.value?.focus()
  } else if (event.key === 'Escape' && typing) {
    ui.query = ''
    searchBox.value?.blur()
  } else if (event.key === 'Escape' && selection.ids.size) {
    clearSelection()
  } else if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey && !inInput) {
    event.preventDefault()
    undo()
  } else if (mod && event.key.toLowerCase() === 'a' && !inInput && ui.view === 'browse') {
    event.preventDefault()
    selectAll()
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection.ids.size && !inInput) {
    event.preventDefault()
    confirmingDelete.value = true
  }
}

let stopListening: (() => void) | undefined
onMounted(() => {
  loadFolder()
  refreshLibrary()
  startTags().catch(console.warn)
  stopListening = onBookmarksChanged(() => {
    refreshLibrary()
    if (searching.value) runSearch()
    else loadFolder()
  })
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
        <button
          class="icon-button"
          :class="{ on: ui.view === 'tags' }"
          :title="tagState.status === 'error' ? `Tags: ${tagState.error}` : 'Tags'"
          @click="ui.view = ui.view === 'tags' ? 'browse' : 'tags'"
        >
          <Icon :name="tagState.status === 'error' ? 'alert' : 'tag'" />
        </button>
        <button class="icon-button" title="Configurações de sincronização (floccus)" @click="openSettings">
          <Icon name="settings" />
        </button>
      </div>
    </div>
    <label class="search">
      <Icon name="search" />
      <input
        ref="searchBox"
        v-model="ui.query"
        type="search"
        placeholder="Buscar nos favoritos, #tags e páginas salvas  /"
        @focus="ui.view = 'browse'"
      />
      <button v-if="ui.query" class="icon-button" title="Limpar" @click="ui.query = ''"><Icon name="x" /></button>
    </label>
    <div v-if="ui.view === 'browse'" class="subbar">
      <div class="tag-strip">
        <button
          v-for="{ tag, count } in stripTags"
          :key="tag"
          class="tag-button"
          :title="`Filtrar por #${tag}`"
          @click="toggleTagFilter(tag)"
        >
          <TagChip :tag="tag" :count="count" :active="parsedQuery.tags.includes(tag)" />
        </button>
      </div>
      <label class="size" title="Tamanho das imagens">
        <Icon name="image" :size="12" />
        <input v-model.number="ui.size" type="range" min="0" max="100" step="1" aria-label="Tamanho das imagens" />
        <Icon name="image" :size="16" />
      </label>
    </div>
  </header>

  <main :style="sizeVars">
    <TagManager v-if="ui.view === 'tags'" />

    <template v-else-if="searching">
      <section>
        <h2>
          {{ parsedQuery.text ? 'Favoritos' : 'Com as tags' }} <span class="count">{{ results.length }}</span>
        </h2>
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
        <span class="spacer" />
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

  <TagEditor v-if="ui.editing" />

  <Transition name="bar">
    <div v-if="selection.ids.size" class="selection-bar" :class="{ danger: confirmingDelete }">
      <template v-if="!confirmingDelete">
        <span class="selection-count">{{ selection.ids.size }} selecionado{{ selection.ids.size === 1 ? '' : 's' }}</span>
        <button class="bar-button" title="Ctrl+A" @click="selectAll">Todos</button>
        <button class="bar-button danger" title="Delete" @click="confirmingDelete = true">
          <Icon name="trash" :size="14" /> Apagar
        </button>
        <button class="icon-button" title="Cancelar seleção (Esc)" @click="clearSelection"><Icon name="x" /></button>
      </template>
      <template v-else>
        <span class="selection-count">
          Apagar {{ selection.ids.size }} favorito{{ selection.ids.size === 1 ? '' : 's' }}?
        </span>
        <button class="bar-button" @click="confirmingDelete = false">Cancelar</button>
        <button class="bar-button solid-danger" @click="deleteSelected"><Icon name="trash" :size="14" /> Apagar</button>
      </template>
    </div>
  </Transition>

  <div class="toasts" :class="{ raised: selection.ids.size }" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast">
      <span>{{ t.text }}</span>
      <button
        v-if="t.action"
        class="toast-action"
        @click="
          t.action.run();
          dismissToast(t.id)
        "
      >
        {{ t.action.label }}
      </button>
    </div>
  </div>
</template>
