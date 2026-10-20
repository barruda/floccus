// Thin helpers over chrome.bookmarks. Floccus syncs whatever ends up in the browser's bookmarks,
// so the panel reads and writes them directly and never touches floccus's own storage.
export type BookmarkNode = chrome.bookmarks.BookmarkTreeNode

export const ROOT_ID = '0'
export const BOOKMARKS_BAR_ID = '1'

export interface FolderEntry {
  node: BookmarkNode
  count: number
}

export async function getFolder(id: string): Promise<{ folders: FolderEntry[]; bookmarks: BookmarkNode[] }> {
  const children = await chrome.bookmarks.getChildren(id)
  const folderNodes = children.filter((c) => !c.url)
  const counts = await Promise.all(folderNodes.map((f) => chrome.bookmarks.getChildren(f.id).then((c) => c.length)))
  return {
    folders: folderNodes.map((node, i) => ({ node, count: counts[i] })),
    bookmarks: children.filter((c) => c.url),
  }
}

// The folder and its ancestors, root first (the invisible root "0" is left out).
export async function getPath(id: string): Promise<BookmarkNode[]> {
  const path: BookmarkNode[] = []
  let current: string | undefined = id
  while (current && current !== ROOT_ID) {
    const [node]: BookmarkNode[] = await chrome.bookmarks.get(current)
    if (!node) break
    path.unshift(node)
    current = node.parentId
  }
  return path
}

export async function folderExists(id: string): Promise<boolean> {
  try {
    const [node] = await chrome.bookmarks.get(id)
    return !!node && !node.url
  } catch {
    return false
  }
}

export async function searchBookmarks(query: string): Promise<BookmarkNode[]> {
  const results = await chrome.bookmarks.search(query)
  return results.filter((r) => r.url).slice(0, 200)
}

// Every bookmark (not folder) in the browser, in tree order.
export async function allBookmarks(): Promise<BookmarkNode[]> {
  const out: BookmarkNode[] = []
  const walk = (nodes: BookmarkNode[]) => {
    for (const node of nodes) {
      if (node.url) out.push(node)
      if (node.children) walk(node.children)
    }
  }
  walk(await chrome.bookmarks.getTree())
  return out
}

export async function bookmarksForUrls(urls: string[]): Promise<BookmarkNode[]> {
  const found = await Promise.all(urls.map((url) => chrome.bookmarks.search({ url }).catch(() => [])))
  return found.map((list) => list[0]).filter((b): b is BookmarkNode => !!b)
}

// Bookmarks open in a new tab; `active: false` (middle click) leaves it in the background.
export async function openUrl(url: string, active: boolean) {
  await chrome.tabs.create({ url, active })
}

export function faviconUrl(pageUrl: string, size = 32): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'))
  url.searchParams.set('pageUrl', pageUrl)
  url.searchParams.set('size', String(size))
  return url.href
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// Calls back (debounced) after any bookmark change, including the bursts a floccus sync makes.
export function onBookmarksChanged(callback: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const fire = () => {
    clearTimeout(timer)
    timer = setTimeout(callback, 250)
  }
  const events = [
    chrome.bookmarks.onCreated,
    chrome.bookmarks.onRemoved,
    chrome.bookmarks.onChanged,
    chrome.bookmarks.onMoved,
    chrome.bookmarks.onChildrenReordered,
  ] as chrome.events.Event<() => void>[]
  events.forEach((event) => event.addListener(fire))
  return () => events.forEach((event) => event.removeListener(fire))
}
