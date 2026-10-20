// Selected bookmarks. Ctrl/Cmd+click or the round checkbox toggles one, Shift+click selects a
// range, and while anything is selected a plain click toggles too. The range follows the order
// on screen, which App registers with setVisible.
import { reactive } from 'vue'
import type { BookmarkNode } from './bookmarks'

export const selection = reactive({ ids: new Set<string>(), anchor: null as string | null })

let visible: () => BookmarkNode[] = () => []

export function setVisible(list: () => BookmarkNode[]) {
  visible = list
}

export function toggleSelected(id: string) {
  if (selection.ids.has(id)) selection.ids.delete(id)
  else selection.ids.add(id)
  selection.anchor = id
}

export function selectRange(id: string) {
  const list = visible()
  const from = list.findIndex((b) => b.id === selection.anchor)
  const to = list.findIndex((b) => b.id === id)
  if (from < 0 || to < 0) return toggleSelected(id)
  const [a, b] = from < to ? [from, to] : [to, from]
  for (const node of list.slice(a, b + 1)) selection.ids.add(node.id)
  selection.anchor = id
}

export function selectAll() {
  for (const node of visible()) selection.ids.add(node.id)
}

export function clearSelection() {
  selection.ids.clear()
  selection.anchor = null
}

export function selectedNodes(): BookmarkNode[] {
  return visible().filter((b) => selection.ids.has(b.id))
}
