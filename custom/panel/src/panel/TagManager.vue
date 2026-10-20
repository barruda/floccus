<script setup lang="ts">
// All tags with their counts (rename, merge, delete) and where they sync to.
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import TagChip from './TagChip.vue'
import { tagCounts } from './library'
import { toggleTagFilter, ui } from './ui'
import { branchUrl } from '../tags/github'
import { parseGitHubRepo, saveManualRepo } from '../tags/credentials'
import { deleteTag, renameTag, sync, tagState } from '../tags/store'

const renaming = ref<string | null>(null)
const newName = ref('')

function startRename(tag: string) {
  renaming.value = tag
  newName.value = tag
}

function finishRename() {
  const from = renaming.value
  renaming.value = null
  if (!from) return
  const target = newName.value.trim()
  const existing = tagCounts.value.some((t) => t.tag === target && t.tag !== from)
  if (existing && !confirm(`#${target} já existe. Juntar #${from} em #${target}?`)) return
  renameTag(from, target)
}

function remove(tag: string, count: number) {
  if (confirm(`Remover #${tag} de ${count} favorito${count === 1 ? '' : 's'}?`)) deleteTag(tag)
}

const lastSync = computed(() =>
  tagState.lastSync ? new Date(tagState.lastSync).toLocaleTimeString('pt-BR', { timeStyle: 'short' }) : null,
)

// Manual repository, for when floccus's profile can't be read.
const showManual = ref(false)
const manualRepo = ref('')
const manualToken = ref('')

async function saveManual() {
  const repo = parseGitHubRepo(manualRepo.value.includes('github.com') ? manualRepo.value : `github.com/${manualRepo.value}`)
  if (!repo || !manualToken.value.trim()) return alert('Informe o repositório (dono/nome) e o token.')
  await saveManualRepo({ ...repo, token: manualToken.value.trim() })
  showManual.value = false
  manualToken.value = ''
  await sync()
}

async function useFloccusProfile() {
  await saveManualRepo(null)
  await sync()
}
</script>

<template>
  <div class="manager">
    <div class="folder-head">
      <button class="icon-button" title="Voltar" @click="ui.view = 'browse'"><Icon name="back" /></button>
      <h1>Tags</h1>
      <span class="spacer" />
    </div>

    <section class="sync-card">
      <div class="sync-line">
        <Icon :name="tagState.status === 'syncing' ? 'spinner' : tagState.status === 'idle' ? 'cloud' : 'alert'" />
        <div class="sync-text">
          <template v-if="tagState.config">
            <a :href="branchUrl(tagState.config)" target="_blank" rel="noreferrer">
              {{ tagState.config.owner }}/{{ tagState.config.repo }} · branch {{ tagState.config.branch }}
            </a>
            <span class="muted">
              {{ tagState.config.source === 'floccus' ? 'credenciais do perfil do floccus' : 'repositório informado aqui' }}
              <template v-if="tagState.status === 'idle' && lastSync"> · sincronizado às {{ lastSync }}</template>
              <template v-if="tagState.status === 'syncing'"> · sincronizando…</template>
            </span>
          </template>
          <span v-if="tagState.error" class="error">{{ tagState.error }}</span>
        </div>
        <button class="text-button" :disabled="tagState.status === 'syncing'" @click="sync()">Sincronizar</button>
      </div>
      <p class="muted small">
        As tags ficam em <code>tags.json</code>, num branch só do painel (<code>panel</code>) do repositório de
        favoritos. O floccus usa o <code>main</code> e nunca mexe nele.
      </p>
      <div class="manual-links">
        <button class="link" @click="showManual = !showManual">Usar outro repositório ou token</button>
        <button v-if="tagState.config?.source === 'manual'" class="link" @click="useFloccusProfile">
          Voltar ao perfil do floccus
        </button>
      </div>
      <form v-if="showManual" class="manual" @submit.prevent="saveManual">
        <input v-model="manualRepo" placeholder="dono/repositório (ex.: barruda/floccus-personal)" />
        <input v-model="manualToken" type="password" placeholder="token do GitHub (Contents: leitura e escrita)" />
        <button class="text-button" type="submit">Salvar</button>
      </form>
    </section>

    <p v-if="!tagCounts.length" class="empty">
      Nenhuma tag ainda. Passe o mouse num favorito e clique no ícone de tag para adicionar.
    </p>
    <ul v-else class="tag-list">
      <li v-for="{ tag, count } in tagCounts" :key="tag">
        <template v-if="renaming === tag">
          <input
            v-model="newName"
            class="rename"
            autofocus
            @keydown.enter.prevent="finishRename"
            @keydown.esc.stop="renaming = null"
            @blur="finishRename"
          />
        </template>
        <button v-else class="tag-open" title="Ver favoritos com esta tag" @click="toggleTagFilter(tag)">
          <TagChip :tag="tag" />
        </button>
        <span class="count">{{ count }}</span>
        <button class="icon-button" title="Renomear ou juntar" @click="startRename(tag)"><Icon name="pencil" /></button>
        <button class="icon-button" title="Remover a tag de todos" @click="remove(tag, count)"><Icon name="trash" /></button>
      </li>
    </ul>
  </div>
</template>
