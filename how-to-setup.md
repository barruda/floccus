# How to set up floccus (dev build) with GitHub sync

## 1. Build the extension

This fork ships upstream floccus plus a bookmarks side panel (see `custom/README.md`). One script
builds both and assembles the extension:

```sh
custom/build.sh
```

The result is in `custom/dist/extension/`. Don't load the repo root: its `manifest.json` is a
stale upstream leftover.

## 2. Load it into Brave (or Chrome)

1. Open `brave://extensions` (Chrome: `chrome://extensions`), or go to Menu → Extensions → Manage extensions.
2. Turn on **Developer mode** with the switch in the top-right corner of the page.
3. Click **Load unpacked** and select `custom/dist/extension`.

After code changes, run `custom/build.sh` again (`--panel-only` if only the panel changed) and
click the reload icon on the extension card. The extension id is fixed by a key in the manifest,
so floccus keeps its profiles across rebuilds.

The toolbar button (or **Alt+Shift+B**) opens the bookmarks panel. Floccus's own settings are on
the button's right-click menu (**Floccus sync settings**) and on the settings button in the panel.

## 3. Create the GitHub repository

Create a repository to hold the bookmarks, preferably private, with **Add a README** checked so the `main` branch exists before the first sync.

## 4. Create a GitHub access token

GitHub does not accept your account password over HTTPS git, so floccus needs a personal access token in its password field.

1. Open https://github.com/settings/personal-access-tokens/new
   (or Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token).
2. **Repository access:** choose "Only select repositories" and pick the bookmarks repository.
3. **Permissions:** click **Add permissions**, search for **Contents**, tick it, and set it to **Read and write**. Metadata (read-only) is required and added automatically. Nothing else is needed.
4. Click **Generate token** and copy it (it starts with `github_pat_`). GitHub shows it only once.

A classic token with the `repo` scope also works.

## 5. Add the profile in floccus

Open floccus's settings (right-click the toolbar button → **Floccus sync settings**) → **Add profile** → **Git**, and fill in:

| Field    | Value                                         |
|----------|-----------------------------------------------|
| URL      | `https://github.com/<username>/<repo>.git`    |
| Username | your GitHub login (as in `github.com/<username>`) |
| Password | the token from step 4                         |
| Branch   | `main` (or whatever the repo's default branch is) |

Use the HTTPS URL, not `git@github.com:...`. Save, then press the sync button.

## 6. Tags (side panel)

The side panel's tags sync to the same repository, on a separate branch named `panel`
(`tags.json`). Floccus keeps using `main`; the panel creates `panel` by itself on the first tag,
using the Git profile's token. Nothing to set up. Details: "Tags" in `custom/README.md`.

## Troubleshooting

- **HTTP Error: 401:** wrong username, an account password instead of a token, or a token that lacks access to the repo or **Contents: Read and write**.
- **Branch not found / empty repo errors:** make sure the repo has at least one commit on the configured branch.
- **Debug logs** in the profile card show the exact request that failed.
