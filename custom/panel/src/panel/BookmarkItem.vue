<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { faviconUrl, hostname, openUrl, type BookmarkNode } from './bookmarks'
import { openSaved, pages, savePage, saving } from './pages'
import { MATCH_END, MATCH_START } from '../shared/protocol'

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

const savedLabel = computed(() => {
  const at = page.value?.archived_at
  return at ? `Salvo em ${new Date(at).toLocaleDateString('pt-BR')}` : ''
})

function open(event: MouseEvent) {
  event.preventDefault()
  openUrl(url.value, event.button === 1 || event.ctrlKey || event.metaKey)
}
</script>

<template>
  <a
    :class="['item', mode]"
    :href="url"
    :title="`${title}\n${url}`"
    @click="open"
    @auxclick="open"
  >
    <div class="preview" :style="{ '--hue': hue }">
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
      <div v-if="snippet" class="snippet">
        <template v-for="(part, i) in snippetParts" :key="i">
          <mark v-if="part.match">{{ part.text }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </div>
    </div>

    <div class="actions" @click.stop.prevent @auxclick.stop.prevent>
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
      <button class="icon-button" title="Abrir em nova aba" @click="openUrl(url, true)">
        <Icon name="external" />
      </button>
    </div>
  </a>
</template>
