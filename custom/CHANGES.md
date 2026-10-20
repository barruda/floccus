# Customization history

One entry per customization, newest last. Each entry matches one `custom:` commit on the `custom`
branch. When an update conflicts, find the failing commit here. **Core files touched** lists what
can conflict with upstream. **Re-apply** says how to redo the change if the surrounding code moved.

Find every patched spot in upstream code with `rg "CUSTOM\("`.

---

## fork-workflow: custom branch, update script, agent skill

- **Added:** 2026-10-20 (based on upstream 5.11.1, `1039cd98`)
- **Commit:** `custom: fork workflow, update script and setup guide`
- **Why:** Keep our changes as a thin layer over upstream floccus that one script can replay on
  every upstream release, the same way the Paseo fork works.
- **What:** `custom/README.md` (workflow), this file, `custom/UPDATE-LOG.md`,
  `custom/update-floccus-source-and-apply-customization.sh`, the agent skill in
  `.claude/skills/floccus-customizations/`, and `how-to-setup.md` (installing the extension and
  setting up GitHub as the sync server).
- **Core files touched:** none (`how-to-setup.md` is a new file at the root).
- **Re-apply:** Nothing to merge; the files are ours.
- **Verify:** `custom/update-floccus-source-and-apply-customization.sh --help`.

## bookmarks-panel: side panel with previews and saved pages

- **Added:** 2026-10-20 (based on upstream 5.11.1, `1039cd98`)
- **Commit:** `custom: bookmarks side panel with previews and saved pages`
- **Why:** The browser's bookmark bar and manager are hard to browse. A side panel shows the same
  bookmarks (the ones floccus syncs) as a grid or list with page previews, and can keep a copy of
  each page.
- **What:**
  - The toolbar button (and Alt+Shift+B) opens a side panel instead of floccus's popup. Floccus's
    settings are on the button's right-click menu ("Floccus sync settings") and the panel's
    settings button.
  - Folder navigation with breadcrumbs, grid or list view (remembered), search over titles and URLs
    and over the text of saved pages (SQLite FTS5, matches highlighted).
  - Previews: a screenshot taken when you visit a bookmarked page (at most weekly per page), else
    the page's `og:image`, else a placeholder colored by site. Titles, descriptions and images come
    from fetching the page (cached 30 days, errors retried after a day).
  - "Salvar HTML" per bookmark or for the whole folder: from the open tab when there is one (what
    the page rendered), otherwise downloaded from the site. Saved copies open in a viewer page, in a
    sandboxed iframe without scripts.
  - Data lives in SQLite (`@sqlite.org/sqlite-wasm`, OPFS SAH pool VFS) in a worker of an offscreen
    document, the only place that opens the database. Rows are keyed by URL, not bookmark id,
    because a floccus sync can recreate bookmarks with new ids. Tables: `pages`, `archives`
    (gzipped HTML), `archive_fts`; migrations in `custom/panel/src/offscreen/db.worker.ts`.
  - The panel never touches floccus's storage; it reads and writes the browser's bookmarks, which
    floccus syncs as usual.
- **Files:** `custom/panel/` (own `package.json`), `custom/assemble.mjs`, `custom/build.sh`,
  `custom/extension-key.txt`, `custom/smoke-test.mjs`.
- **Core files touched:** none. `assemble.mjs` depends on `manifest.chrome.json` having an
  `action`, the service worker at `dist/js/background-script.js`, and an `extension_pages` CSP with
  `script-src 'self'`; it stops with an error if any of these change.
- **Re-apply:** If upstream moves its service worker, point `panel-sw.js` (written by
  `assemble.mjs`) at the new path; it must sit in the same folder, because floccus loads its chunks
  with `importScripts('./<chunk>.js')` relative to the worker. If upstream starts using
  `chrome.sidePanel`, the toolbar button or `runtime.onMessage` in the service worker, check for
  clashes: our messages carry `channel: 'floccus-panel'`.
- **Verify:** `custom/build.sh && node custom/smoke-test.mjs` (headless Brave in a
  throwaway profile). The update script runs both.

## panel-tags: tags per bookmark, synced on the `panel` branch

- **Added:** 2026-10-20 (based on upstream 5.11.1, `1039cd98`)
- **Commit:** `custom: tags in the side panel, synced to the panel branch on GitHub`
- **Why:** Tags for bookmarks without putting them in the titles (which would clutter the
  browser's bookmarks bar) and without depending on this browser's local database: they must
  reach every browser of the user.
- **What:**
  - Tags show as colored chips on each bookmark; the tag button on a bookmark edits them (with
    autocomplete). A strip under the search box lists all tags by use; clicking one writes `#tag`
    into the search, which filters every folder (`#receitas pão` mixes tags and text, also over
    saved pages' content).
  - Tags screen (tag button in the header): rename, merge (rename onto an existing tag), delete,
    sync status, and a manual repository/token setting.
  - Storage: `tags.json` on the orphan branch `panel` of the bookmarks repository
    (`barruda/floccus-personal`), never on floccus's `main` (floccus force-pushes it when syncing
    from scratch). The branch gets a README explaining it. See "Tags" in `custom/README.md`.
  - Sync through GitHub's REST API (`custom/panel/src/tags/github.ts`), merged per URL by
    `updatedAt` with tombstones for removals (`model.ts`); local copy in `chrome.storage.local`
    under `floccus-panel.tags`; credentials read from floccus's Git profile (`credentials.ts`),
    or `floccus-panel.tagsRepo` when set in the panel.
- **Files:** `custom/panel/src/tags/`, `custom/panel/src/panel/{library.ts,ui.ts,TagChip.vue,TagEditor.vue,TagManager.vue}`,
  changes to `App.vue`, `BookmarkItem.vue`, `bookmarks.ts`, `Icon.vue`, `styles.css`; smoke test
  with a fake GitHub API.
- **Core files touched:** none. Reads floccus's `accounts` and `accountsLocked` entries from
  `chrome.storage.local` (format of `src/lib/browser/BrowserAccountStorage.js`, Git profile fields
  of `src/lib/adapters/Git.ts`).
- **Re-apply:** If floccus changes how it stores profiles (key names, encryption), adapt
  `loadConfig` in `custom/panel/src/tags/credentials.ts`; the manual setting keeps working
  meanwhile.
- **Verify:** `node custom/smoke-test.mjs` (tag checks: editor, push to a new `panel` branch with
  README, merge of a remote edit, rename, filter).
