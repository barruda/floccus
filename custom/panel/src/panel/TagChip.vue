<script setup lang="ts">
import { computed } from 'vue'
import { tagHue } from '../tags/model'

const props = defineProps<{ tag: string; active?: boolean; count?: number }>()
const hue = computed(() => tagHue(props.tag))
</script>

<template>
  <span class="chip" :class="{ active }" :style="{ '--tag-hue': hue }">
    <span class="hash">#</span>{{ tag }}<span v-if="count !== undefined" class="chip-count">{{ count }}</span>
    <slot />
  </span>
</template>
