#!/usr/bin/env bash
# Builds floccus and the side panel, then assembles the extension in custom/dist/extension.
# See custom/README.md.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: custom/build.sh [--panel-only]

  --panel-only   Skip the floccus build (reuse dist/) and rebuild only the panel. Use it while
                 working on the panel; floccus's build takes about half a minute.
EOF
}

PANEL_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --panel-only) PANEL_ONLY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

ROOT="$(git -C "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" rev-parse --show-toplevel)"
cd "$ROOT"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

if [[ "$PANEL_ONLY" == false ]]; then
  [[ -d node_modules ]] || { step "Installing floccus dependencies"; npm ci; }
  step "Building floccus"
  npm run build
fi

step "Building the panel"
[[ -d custom/panel/node_modules ]] || npm --prefix custom/panel ci
npm --prefix custom/panel run build

step "Assembling the extension"
node custom/assemble.mjs
echo "Load or reload: $ROOT/custom/dist/extension"
