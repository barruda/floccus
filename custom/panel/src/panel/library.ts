// All bookmarks at once, for what spans folders: tag counts and tag filters. Rebuilt on every
// bookmark change (a tree read takes milliseconds even with thousands of bookmarks).
import { computed, reactive } from 'vue'
import { allBookmarks, type BookmarkNode } from './bookmarks'
import { tagState } from '../tags/store'

export const library = reactive({ bookmarks: [] as BookmarkNode[] })

export async function refreshLibrary() {
  library.bookmarks = await allBookmarks()
}

// Tags with how many bookmarks carry them, most used first. Tags of URLs that are no longer
// bookmarked stay in tags.json (they come back with the bookmark) but aren't counted.
export const tagCounts = computed(() => {
  const urls = new Set(library.bookmarks.map((b) => b.url!))
  const counts = new Map<string, number>()
  for (const [url, entry] of Object.entries(tagState.file.entries)) {
    if (!urls.has(url)) continue
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
})

export function bookmarksWithTags(tags: string[], within: BookmarkNode[] = library.bookmarks): BookmarkNode[] {
  const seen = new Set<string>()
  return within.filter((b) => {
    const has = tagState.file.entries[b.url!]?.tags ?? []
    if (!tags.every((t) => has.includes(t))) return false
    // The same page bookmarked twice shows once.
    if (seen.has(b.url!)) return false
    seen.add(b.url!)
    return true
  })
}
