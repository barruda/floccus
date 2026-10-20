---
name: floccus-customizations
description: Maintain the user's customized floccus build — the `custom` branch rebased on upstream marcelklehr/floccus, with the bookmarks side panel in custom/panel. Use when asked to add or change a feature of their floccus (the side panel, previews, saved pages), update/pull upstream floccus, rebuild or reinstall the extension, resolve a conflict after an update, or set it up on a new machine.
user-invocable: true
---

# floccus customizations

This checkout is upstream floccus plus the user's own changes, kept as `custom:` commits on the
`custom` branch. Read `custom/README.md` for the workflow, then `custom/CHANGES.md` for what each
customization does. Those two files are the source of truth; this skill only lists the rules
agents get wrong.

## Rules

- Work on `custom`. Never commit customizations to `develop`.
- Remotes: `origin` is upstream (fetch only), `fork` is the user's backup (barruda/floccus). Both
  use the `github.com-personal` SSH alias; never switch them to plain `github.com`, which
  authenticates as the work account.
- Keep changes under `custom/`. The extension the user loads is assembled by `custom/assemble.mjs`
  from upstream's `manifest.chrome.json` and `dist/` plus our panel, so manifest changes go into
  `assemble.mjs`, never into `manifest*.json`. An unavoidable edit to an upstream file stays small
  and carries a `// CUSTOM(<name>): <why>` comment.
- The loaded extension is `custom/dist/extension/`, never the repo root (its `manifest.json` is a
  stale upstream leftover). The `key` in `custom/extension-key.txt` pins the id
  `lejbjdlcofjbakbejknhflmebefennom`; don't change it, or floccus loses its profiles.
- One commit per customization, subject `custom: <what>`. Fold fixes into it with
  `git commit --fixup <sha>` and `git rebase --autosquash "$(git merge-base HEAD origin/develop)"`.
- Stage files by name; never `git commit -a` or `git add -A`.
- Every customization gets a `custom/CHANGES.md` entry with: Added, Commit, Why, What, Files,
  Core files touched, Re-apply, Verify.
- Panel code: `npm --prefix custom/panel run build` typechecks (vue-tsc) and builds. Add a check to
  `custom/smoke-test.mjs` for new behavior; it runs headless Brave in a throwaway profile, so run it
  freely: `custom/build.sh --panel-only && node custom/smoke-test.mjs --screenshots <dir>`. Look at
  the screenshots for UI changes.
- In the smoke test, DevTools evaluation inside the service worker has no `chrome.*` APIs; call
  them from an extension page (the test uses `panel/viewer.html` as a helper). Don't open
  `panel/offscreen.html` as a tab: a second copy would fight the offscreen document over the
  SQLite file.
- Database schema changes are a new entry appended to `MIGRATIONS` in
  `custom/panel/src/offscreen/db.worker.ts`; never edit an existing migration (users already ran it).
- After committing, back up with `git push --force-with-lease fork custom` (only when the user
  asked to push).

## Shipping a change to the user's browser

- Build: `custom/build.sh` (or `--panel-only` when floccus itself didn't change).
- The user's personal browser is Brave with `--user-data-dir ~/.config/brave-personal`; the
  `brave-telus` one is work, leave it alone. You can't click "reload" in their browser: tell them
  to press the reload icon on the "floccus bookmarks sync (custom)" card in `brave://extensions`.
- Pulling upstream: `custom/update-floccus-source-and-apply-customization.sh`. It rebuilds, runs
  the smoke test and pushes to `fork`.

## Update conflicts

The script stops mid-rebase and prints the failing commit. Find its entry with
`git show <backup-tag>:custom/CHANGES.md`, redo the change on the new upstream code following
**Re-apply**, `git add` the files, and run `.git/custom-update.sh --continue`. If upstream shipped
the same feature, tell the user before dropping a customization. If `assemble.mjs` fails after an
update, upstream changed `manifest.chrome.json`; adapt the assembler, not the manifest.
