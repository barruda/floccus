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
