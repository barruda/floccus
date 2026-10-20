<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { faviconUrl, hostname, openUrl, type BookmarkNode } from './bookmarks'
import { openSaved, pages, savePage, saving } from './pages'
import { MATCH_END, MATCH_START } from '../shared/protocol'
import TagChip from './TagChip.vue'
import { parseQuery } from '../tags/model'
import { tagsFor } from '../tags/store'
import { toggleTagFilter, ui } from './ui'
import { selectRange, selection, toggleSelected } from './selection'
import { removeBookmarks, removing } from './trash'

const props = defineProps<{ bookmark: BookmarkNode; mode: 'grid' | 'list'; snippet?: string }>()

const url = computed(() => props.bookmark.url!)
const page = computed(() => pages.get(url.value))
const host = computed(() => hostname(url.value))
const title = computed(() => props.bookmark.title || page.value?.title || host.value)
const favicon = computed(() => faviconUrl(url.value, props.mode === 'grid' ? 64 : 32))
const isSaving = computed(() => saving.has(url.value))
const isSaved = computed(() => !!page.value?.archived_at)

// The page's own screenshot looks most like what you will open; the og:image is the fallback.
const brokenImages = ref(new Set<string>())
const preview = computed(() =>
  [page.value?.shot, page.value?.image].find((src): src is string => !!src && !brokenImages.value.has(src)),
)
watch(url, () => brokenImages.value.clear())

// A stable hue per site for the placeholder, so cards of the same site look related.
const hue = computed(() => {
  let h = 0
  for (const c of host.value) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
})

const subtitle = computed(() => (props.mode === 'list' && !props.snippet ? page.value?.description : null))

// Search hits: the matched words of the saved page's text, highlighted.
const snippetParts = computed(() =>
  (props.snippet ?? '').split(MATCH_START).flatMap((chunk, i) => {
    if (i === 0) return [{ text: chunk, match: false }]
    const [match, rest = ''] = chunk.split(MATCH_END)
    return [
      { text: match, match: true },
      { text: rest, match: false },
    ]
  }),
)

const tags = computed(() => tagsFor(url.value))
const activeTags = computed(() => parseQuery(ui.query).tags)

function editTags() {
  ui.editing = { url: url.value, title: title.value }
}

const savedLabel = computed(() => {
  const at = page.value?.archived_at
  return at ? `Salvo em ${new Date(at).toLocaleDateString('pt-BR')}` : ''
})

const selected = computed(() => selection.ids.has(props.bookmark.id))

// Click opens in a new tab. Ctrl/Cmd+click and Shift+click select instead, and once anything
// is selected a plain click keeps selecting.
function onClick(event: MouseEvent) {
  event.preventDefault()
  if (event.shiftKey) selectRange(props.bookmark.id)
  else if (event.ctrlKey || event.metaKey || selection.ids.size) toggleSelected(props.bookmark.id)
  else openUrl(url.value, true)
}

// Middle click: new tab in the background. Other buttons (the context menu) are left alone.
function onAuxClick(event: MouseEvent) {
  if (event.button !== 1) return
  event.preventDefault()
  openUrl(url.value, false)
}
</script>

<template>
  <a
    :class="['item', mode, { selected, selecting: selection.ids.size > 0, removing: removing.has(bookmark.id) }]"
    :href="url"
    :title="`${title}\n${url}`"
    @click="onClick"
    @auxclick="onAuxClick"
  >
    <div class="preview" :style="{ '--hue': hue }">
      <button
        class="select"
        :title="selected ? 'Desmarcar' : 'Selecionar'"
        @click.stop.prevent="$event.shiftKey ? selectRange(bookmark.id) : toggleSelected(bookmark.id)"
      >
        <Icon name="check" :size="12" />
      </button>
      <img
        v-if="preview"
        class="shot"
        :src="preview"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        @error="brokenImages.add(preview)"
      />
      <div v-else class="placeholder">
        <img :src="favicon" alt="" />
        <span v-if="mode === 'grid'">{{ host }}</span>
      </div>
      <span v-if="isSaved" class="badge" :title="savedLabel"><Icon name="saved" :size="12" /></span>
    </div>

    <div class="text">
      <div class="title">
        <img v-if="mode === 'grid'" class="favicon" :src="favicon" alt="" />
        <span>{{ title }}</span>
      </div>
      <div class="meta">
        <span class="host">{{ host }}</span>
        <span v-if="subtitle" class="subtitle"> · {{ subtitle }}</span>
      </div>
      <div v-if="tags.length" class="tags" @click.stop.prevent @auxclick.stop.prevent>
        <button v-for="tag in tags" :key="tag" class="tag-button" :title="`Filtrar por #${tag}`" @click="toggleTagFilter(tag)">
          <TagChip :tag="tag" :active="activeTags.includes(tag)" />
        </button>
      </div>
      <div v-if="snippet" class="snippet">
        <template v-for="(part, i) in snippetParts" :key="i">
          <mark v-if="part.match">{{ part.text }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </div>
    </div>

    <div class="actions" @click.stop.prevent @auxclick.stop.prevent>
      <button class="icon-button" title="Tags" @click="editTags"><Icon name="tag" /></button>
      <button
        class="icon-button"
        :title="isSaved ? 'Salvar de novo' : 'Salvar HTML'"
        :disabled="isSaving"
        @click="savePage(url, bookmark.title || null)"
      >
        <Icon :name="isSaving ? 'spinner' : isSaved ? 'refresh' : 'save'" />
      </button>
      <button v-if="isSaved" class="icon-button" title="Ver cópia salva" @click="openSaved(url)">
        <Icon name="saved" />
      </button>
      <button class="icon-button danger" title="Apagar (Ctrl+Z desfaz)" @click="removeBookmarks([bookmark])">
        <Icon name="trash" />
      </button>
    </div>
  </a>
</template>
