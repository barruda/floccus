// Runs inside floccus's service worker (see dist/js/panel-sw.js in the assembled extension).
// It opens the side panel from the toolbar button, keeps floccus's settings one right-click
// away, owns the offscreen document, and takes a screenshot of bookmarked pages as you visit
// them so the panel can show what each page looks like.
import {
  CHANNEL,
  OFFSCREEN_PATH,
  isEnvelope,
  type OffscreenRequest,
  type OffscreenResults,
  type PageRow,
  type Reply,
} from '../shared/protocol'

const SETTINGS_MENU_ID = 'floccus-panel-settings'
const SHOT_MAX_AGE = 7 * 24 * 60 * 60 * 1000
const SHOT_DELAY = 1500

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SETTINGS_MENU_ID,
      title: 'Floccus sync settings',
      contexts: ['action'],
    })
  })
})

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === SETTINGS_MENU_ID) {
    chrome.tabs.create({ url: chrome.runtime.getURL('dist/html/options.html') })
  }
})

let creatingOffscreen: Promise<void> | null = null

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH)
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  })
  if (contexts.length) return
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.DOM_PARSER],
      justification: 'SQLite database with bookmark previews and saved pages',
    })
    .finally(() => {
      creatingOffscreen = null
    })
  await creatingOffscreen
}

async function offscreen<R extends OffscreenRequest>(req: R): Promise<OffscreenResults[R['op']]> {
  await ensureOffscreen()
  const reply: Reply<OffscreenResults[R['op']]> | undefined = await chrome.runtime.sendMessage({
    channel: CHANNEL,
    target: 'offscreen',
    ...req,
  })
  if (!reply) throw new Error(`No answer to ${req.op}`)
  if ('error' in reply) throw new Error(reply.error)
  return reply.result
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isEnvelope(msg) || msg.target !== 'background') return false
  if (msg.op === 'ensureOffscreen') {
    ensureOffscreen().then(
      () => sendResponse({ result: null }),
      (err) => sendResponse({ error: String(err?.message ?? err) }),
    )
    return true
  }
  return false
})

// Screenshots: captureVisibleTab only sees the active tab of a window, so we wait until a
// bookmarked page has finished loading in front of the user, then check it is still there.
const pendingShots = new Map<number, ReturnType<typeof setTimeout>>()

function scheduleShot(tab: chrome.tabs.Tab) {
  if (tab.id === undefined || !tab.active || !tab.url?.startsWith('http')) return
  const tabId = tab.id
  const url = tab.url
  clearTimeout(pendingShots.get(tabId))
  pendingShots.set(
    tabId,
    setTimeout(() => {
      pendingShots.delete(tabId)
      takeShot(tabId, url).catch((err) => console.debug('[floccus-panel] screenshot skipped', err))
    }, SHOT_DELAY),
  )
}

async function takeShot(tabId: number, url: string) {
  const tab = await chrome.tabs.get(tabId)
  if (!tab.active || tab.url !== url || tab.status !== 'complete') return
  const bookmarks = await chrome.bookmarks.search({ url })
  if (!bookmarks.length) return
  const [row]: PageRow[] = await offscreen({ op: 'pages.get', urls: [url] })
  if (row?.shot_at && Date.now() - row.shot_at < SHOT_MAX_AGE) return
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 })
  await offscreen({ op: 'shot.put', url, dataUrl })
}

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status === 'complete') scheduleShot(tab)
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then((tab) => {
    if (tab.status === 'complete') scheduleShot(tab)
  }, console.debug)
})
