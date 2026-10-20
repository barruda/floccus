// Deleting bookmarks with undo (the toast's "Desfazer" or Ctrl+Z). The browser can't restore a
// removed bookmark, so undo creates it again where it was: same folder, position, title and
// URL. It gets a new id, which floccus syncs as a new bookmark; tags, previews and saved pages
// are keyed by URL, so they come back with it.
import { reactive } from 'vue'
import type { BookmarkNode } from './bookmarks'
import { dismissToast, toast } from './pages'

// Ids fading out: the item shrinks and fades, then the bookmark is removed.
export const removing = reactive(new Set<string>())
const FADE = 170

interface Removed {
  parentId: string
  index: number
  title: string
  url: string
}

interface Batch {
  items: Removed[]
  toastId: number
}

const UNDO_DEPTH = 20
const undoStack: Batch[] = []

export async function removeBookmarks(nodes: BookmarkNode[]) {
  const batch = nodes
    .filter((n) => n.url && n.parentId !== undefined)
    .map((n) => ({ parentId: n.parentId!, index: n.index ?? 0, title: n.title, url: n.url! }))
  if (!batch.length) return
  for (const node of nodes) removing.add(node.id)
  await new Promise((r) => setTimeout(r, FADE))
  for (const node of nodes) {
    await chrome.bookmarks.remove(node.id).catch(console.warn)
    removing.delete(node.id)
  }
  const entry: Batch = { items: batch, toastId: 0 }
  const what = batch.length === 1 ? `"${batch[0].title || batch[0].url}" apagado` : `${batch.length} favoritos apagados`
  // The toast's button undoes this deletion, even if others came after it.
  entry.toastId = toast(what, { label: 'Desfazer', run: () => undo(entry) })
  undoStack.push(entry)
  if (undoStack.length > UNDO_DEPTH) undoStack.shift()
}

// Ctrl+Z undoes the latest deletion; the toast passes its own.
export async function undo(entry = undoStack.at(-1)) {
  const i = entry ? undoStack.indexOf(entry) : -1
  if (!entry || i < 0) return
  undoStack.splice(i, 1)
  dismissToast(entry.toastId)
  const batch = entry.items
  // Lowest index first, so each one lands back in its old slot.
  const ordered = [...batch].sort((a, b) => a.parentId.localeCompare(b.parentId) || a.index - b.index)
  for (const item of ordered) {
    try {
      await chrome.bookmarks.create(item)
    } catch {
      // The folder is gone too: keep the bookmark rather than lose it.
      await chrome.bookmarks.create({ title: item.title, url: item.url })
    }
  }
  toast(batch.length === 1 ? 'Favorito restaurado' : `${batch.length} favoritos restaurados`)
}
