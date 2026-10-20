<script setup lang="ts">
// Edits the tags of ui.editing. Every change is saved at once; the dialog only closes.
import { computed, nextTick, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import TagChip from './TagChip.vue'
import { tagCounts } from './library'
import { ui } from './ui'
import { normalizeTag } from '../tags/model'
import { setTags, tagsFor } from '../tags/store'

const input = ref<HTMLInputElement>()
const draft = ref('')
const highlighted = ref(0)

const url = computed(() => ui.editing!.url)
const current = computed(() => tagsFor(url.value))

const suggestions = computed(() => {
  const typed = normalizeTag(draft.value)
  return tagCounts.value
    .map((t) => t.tag)
    .filter((t) => !current.value.includes(t) && (!typed || t.includes(typed)))
    .sort((a, b) => Number(b.startsWith(typed)) - Number(a.startsWith(typed)))
    .slice(0, 8)
})

function add(raw: string) {
  const tag = normalizeTag(raw)
  if (tag && !current.value.includes(tag)) setTags(url.value, [...current.value, tag])
  draft.value = ''
  highlighted.value = 0
  input.value?.focus()
}

function remove(tag: string) {
  setTags(url.value, current.value.filter((t) => t !== tag))
  input.value?.focus()
}

function close() {
  if (draft.value.trim()) add(draft.value)
  ui.editing = null
}

function onKey(event: KeyboardEvent) {
  const list = suggestions.value
  if (event.key === 'ArrowDown' && list.length) {
    event.preventDefault()
    highlighted.value = (highlighted.value + 1) % list.length
  } else if (event.key === 'ArrowUp' && list.length) {
    event.preventDefault()
    highlighted.value = (highlighted.value - 1 + list.length) % list.length
  } else if (event.key === 'Enter' || event.key === 'Tab' || event.key === ',') {
    if (!draft.value.trim() && event.key !== 'Enter') return
    event.preventDefault()
    if (!draft.value.trim() && event.key === 'Enter') return close()
    const typed = normalizeTag(draft.value)
    const pick = list[highlighted.value]
    // Enter takes the highlighted suggestion only if it starts with what was typed;
    // otherwise the typed text is the new tag.
    add(pick && pick.startsWith(typed) ? pick : draft.value)
  } else if (event.key === 'Backspace' && !draft.value && current.value.length) {
    remove(current.value[current.value.length - 1])
  } else if (event.key === 'Escape') {
    event.stopPropagation()
    close()
  }
}

onMounted(() => nextTick(() => input.value?.focus()))
</script>

<template>
  <div class="overlay" @click.self="close">
    <div class="dialog" role="dialog" aria-label="Tags do favorito">
      <div class="dialog-head">
        <Icon name="tag" />
        <span class="dialog-title" :title="ui.editing!.title">{{ ui.editing!.title }}</span>
        <button class="icon-button" title="Fechar" @click="close"><Icon name="x" /></button>
      </div>
      <div class="tag-input" @click="input?.focus()">
        <TagChip v-for="tag in current" :key="tag" :tag="tag">
          <button class="chip-remove" :title="`Remover #${tag}`" @click.stop="remove(tag)">
            <Icon name="x" :size="11" />
          </button>
        </TagChip>
        <input
          ref="input"
          v-model="draft"
          :placeholder="current.length ? '' : 'Adicionar tag…'"
          @keydown="onKey"
          @input="highlighted = 0"
        />
      </div>
      <div v-if="suggestions.length" class="suggestions">
        <button
          v-for="(tag, i) in suggestions"
          :key="tag"
          :class="{ on: i === highlighted }"
          @mouseenter="highlighted = i"
          @click="add(tag)"
        >
          <TagChip :tag="tag" />
        </button>
      </div>
      <p class="hint">Enter adiciona · Backspace remove a última · Esc fecha</p>
    </div>
  </div>
</template>
