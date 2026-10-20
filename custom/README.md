# Local customizations

This checkout runs upstream floccus plus our own changes. The changes are commits on the `custom`
branch, on top of upstream's `develop`. Updating means rebasing that branch onto the new upstream,
which the update script does for you.

| Remote   | Repository          | Used for                                                          |
| -------- | ------------------- | ----------------------------------------------------------------- |
| `origin` | marcelklehr/floccus | Upstream. Fetch only.                                             |
| `fork`   | barruda/floccus     | Backup of `custom`. The update script pushes after every update.  |

Both remotes use the `github.com-personal` SSH alias, so git authenticates with the personal
GitHub account instead of the work one.

| Path                                               | What it is                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CHANGES.md`                                       | Every customization: what, why, files touched, re-apply notes. Read this when a rebase conflicts.           |
| `UPDATE-LOG.md`                                    | Written by the update script: upstream before/after, backup tag.                                            |
| `update-floccus-source-and-apply-customization.sh` | Fetch upstream, replay customizations, build, smoke test, back up to `fork`.                                |
| `build.sh`                                         | Build floccus and the panel and assemble the extension. `--panel-only` skips floccus.                       |
| `assemble.mjs`                                     | Writes `custom/dist/extension/`: upstream's Chrome manifest and build plus the panel, with the manifest patched. |
| `panel/`                                           | The bookmarks side panel (Vue 3 + Vite + SQLite in WebAssembly). Its own `package.json`.                    |
| `smoke-test.mjs`                                   | Headless Brave run of the assembled extension in a throwaway profile.                                       |
| `extension-key.txt`                                | Public key that pins the extension id to `lejbjdlcofjbakbejknhflmebefennom`.                                |

Agents (Claude Code) have a skill for this workflow: `.claude/skills/floccus-customizations/`.

## How the customizations stay out of upstream's way

We never edit upstream's files if we can avoid it. Instead, `assemble.mjs` builds the extension we
load from upstream's own output:

- `manifest.chrome.json` (what upstream ships to the Chrome store), patched in memory: the panel's
  permissions, `side_panel`, the toolbar button opening the panel, `'wasm-unsafe-eval'` for
  SQLite, the fixed `key`, and a service worker of ours.
- `dist/` from upstream's `npm run build`, without source maps and node tests (the same files its
  release zip packs), plus `icons/` and `_locales/`.
- `panel/` with our pages and `dist/js/panel-sw.js`, which `importScripts` floccus's worker and
  then ours.

The root `manifest.json` is a stale development leftover upstream no longer updates; don't load the
repo root as the extension.

## Tags: the `panel` branch of the bookmarks repository

Two GitHub repositories are involved, and it is easy to mix them up:

| Repository                | What it holds                                                    |
| ------------------------- | ---------------------------------------------------------------- |
| `barruda/floccus`         | This code (the fork). Branch `custom` = our changes.             |
| `barruda/floccus-personal`| The **data**: the synced bookmarks. Private.                     |

The data repository has two branches, each written by a different program:

```
barruda/floccus-personal
├── main    README.md, bookmarks.xbel   ← floccus writes it (the Git profile's branch)
└── panel   README.md, tags.json        ← the side panel writes it
```

- **Why a separate branch:** floccus owns `main`. "Sync from scratch" or resetting the profile makes
  floccus re-create `main` with a force push (`src/lib/adapters/Git.ts`, `init`), which would delete
  any file of ours there. On `panel`, floccus never touches it. The branch has no history in common
  with `main`; the panel creates it (as an orphan branch, with a README explaining it) on the first
  tag.
- **What tags.json holds:** tags per page URL (not per bookmark id, which differs between
  browsers), each with an `updatedAt`. Syncing merges per URL and the newer entry wins; removed
  tags stay as an empty entry (a tombstone) for 180 days so the removal reaches other browsers.
  Format and merge: `custom/panel/src/tags/model.ts`.
- **Who sees the tags:** only this side panel. Bookmark titles, the browser's bookmarks bar and the
  floccus mobile app don't change and don't see them.
- **Credentials:** the panel reads floccus's Git profile (repository URL and token) from floccus's
  storage, read-only. If floccus's profiles are locked with a password, or to use another
  repository, set one in the panel: **Tags** button → "Usar outro repositório ou token". The token
  needs **Contents: Read and write** on the data repository (the same token floccus uses works).
- **When it syncs:** when the panel opens or becomes visible, 1.5 s after each edit, and every
  5 minutes while it is open. A local copy in the extension's storage keeps tags working offline.
- **Known gap:** changing a bookmark's URL (outside the panel) leaves its tags on the old URL.
  Tags of a deleted bookmark stay in tags.json and come back if the page is bookmarked again.
- **Editing by hand:** fine on GitHub, on the `panel` branch; keep the format and raise the
  `updatedAt` of the entries you change, or the next merge may prefer the browser's copy.

## Installing

```bash
custom/build.sh
```

Then in `brave://extensions` (Developer mode on): **Load unpacked** →
`custom/dist/extension`. After later builds, press the reload icon on its card. The id never
changes, so floccus keeps its profiles across rebuilds and reinstalls.

## Updating

```bash
git checkout custom
custom/update-floccus-source-and-apply-customization.sh
```

Then reload the extension. `--ref v5.11.1` follows a release tag instead of `develop`.
`--no-build` only rebases. Before rebasing, the script tags the current state as
`custom-backup/<timestamp>`; roll back with `git reset --hard custom-backup/<timestamp>`.

### When the rebase conflicts

The script stops and prints which customization failed. Look that commit up in `CHANGES.md`. Its
entry says what the change does, so you can redo it on top of the new upstream code. Then
`git add` the files and run `.git/custom-update.sh --continue`.

The script runs from that copy in `.git/` because mid-rebase the working tree may not contain
`custom/` yet. For the same reason, read the history with `git show <backup-tag>:custom/CHANGES.md`.

Most upstream changes can't conflict at all, since our commits only add files under `custom/`. What
can break instead is `assemble.mjs`, which fails loudly when `manifest.chrome.json` changes shape
(no `action`, a different service worker path, a different CSP).

## Adding a customization

1. Work on the `custom` branch. Prefer code under `custom/` (the panel, the assembler) over edits
   to upstream files. When an upstream file must change, keep the edit small and mark it with a
   `CUSTOM(<name>)` comment; `rg "CUSTOM\("` lists every patched spot.
2. Add checks to `smoke-test.mjs` (the update script runs it).
3. Commit with a `custom: ` subject prefix, one commit per customization. Stage files by name.
   Fold follow-up fixes into their customization: `git commit --fixup <sha>`, then
   `git rebase --autosquash "$(git merge-base HEAD origin/develop)"`.
4. Add an entry to `CHANGES.md`.
5. Back up: `git push --force-with-lease fork custom`.

## New machine

```bash
git clone -b custom git@github.com-personal:barruda/floccus.git floccus && cd floccus
git remote rename origin fork
git remote add origin git@github.com-personal:marcelklehr/floccus.git
git fetch origin
custom/build.sh
```
