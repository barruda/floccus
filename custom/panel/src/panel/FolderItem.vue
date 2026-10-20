<script setup lang="ts">
import Icon from './Icon.vue'
import type { FolderEntry } from './bookmarks'

defineProps<{ folder: FolderEntry; mode: 'grid' | 'list' }>()
defineEmits<{ open: [id: string] }>()
</script>

<template>
  <button :class="['folder', mode]" @click="$emit('open', folder.node.id)">
    <Icon name="folder" :size="18" />
    <span class="name">{{ folder.node.title || 'Sem nome' }}</span>
    <span class="count">{{ folder.count }}</span>
  </button>
</template>
