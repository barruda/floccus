#!/usr/bin/env bash
# Pull upstream floccus, replay our customizations (the commits on the `custom` branch) on top,
# rebuild, verify, and back the branch up to the fork. See custom/README.md.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: custom/update-floccus-source-and-apply-customization.sh [options]

  --ref <ref>     Upstream ref to rebase onto (default: origin/develop). Use a tag such as
                  v5.11.1 to stay on a release.
  --continue      Finish an update that stopped on a rebase conflict, after you resolved
                  and staged the conflicted files.
  --no-verify     Skip the panel smoke test.
  --no-build      Rebase only.
  --no-push       Don't back the branch up to the fork.
  -h, --help      Show this help.

Environment:
  CUSTOM_BRANCH         Branch holding the customizations (default: custom)
  CUSTOM_BACKUP_REMOTE  Remote that receives the rebased branch (default: fork)
EOF
}

SCRIPT_PATH="$(realpath "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
if [[ -n "${CUSTOM_UPDATE_ROOT:-}" ]]; then
  ROOT="$CUSTOM_UPDATE_ROOT"
elif [[ "$(basename "$SCRIPT_DIR")" == ".git" ]]; then
  ROOT="$(dirname "$SCRIPT_DIR")"
else
  ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
fi
cd "$ROOT"
GIT_DIR_ABS="$(git rev-parse --absolute-git-dir)"
STATE_FILE="$GIT_DIR_ABS/custom-update-state"
LOG_FILE="$ROOT/custom/UPDATE-LOG.md"

# This script is itself a customization, so a rebase stopped partway can remove it from the
# working tree. Run from a copy in .git so --continue always has a script to run.
RUNNER="$GIT_DIR_ABS/custom-update.sh"
if [[ "$SCRIPT_PATH" != "$RUNNER" ]]; then
  cp "$SCRIPT_PATH" "$RUNNER"
  chmod +x "$RUNNER"
  CUSTOM_UPDATE_ROOT="$ROOT" exec "$RUNNER" "$@"
fi

REF="origin/develop"
CONTINUE=false
VERIFY=true
BUILD=true
PUSH=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:?--ref needs a value}"; shift 2 ;;
    --continue) CONTINUE=true; shift ;;
    --no-verify) VERIFY=false; shift ;;
    --no-build) BUILD=false; shift ;;
    --no-push) PUSH=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

BRANCH="${CUSTOM_BRANCH:-custom}"
BACKUP_REMOTE="${CUSTOM_BACKUP_REMOTE:-fork}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

rebase_in_progress() {
  [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]
}

conflict_help() {
  local backup_tag
  backup_tag="$(sed -n 's/^backup=//p' "$STATE_FILE" 2>/dev/null)"
  cat >&2 <<EOF

The rebase stopped on a conflict while replaying a customization.

  1. See which customization is being applied:   git log -1 --format='%h %s' REBASE_HEAD
     Read its entry in the history (it may be missing from the working tree right now):
                                                   git show $backup_tag:custom/CHANGES.md
  2. Fix the files listed by:                      git diff --name-only --diff-filter=U
     then stage them:                              git add <files>
  3. Resume:                                       $RUNNER --continue

To give up and go back to where you were:          git rebase --abort
(The pre-update state is also saved as tag $backup_tag.)
EOF
}

if [[ "$CONTINUE" == true ]]; then
  [[ -f "$STATE_FILE" ]] || die "No update in progress (missing $STATE_FILE)."
  if rebase_in_progress; then
    step "Continuing the rebase"
    GIT_EDITOR=true git rebase --continue || { conflict_help; exit 1; }
  fi
else
  [[ "$(git branch --show-current)" == "$BRANCH" ]] || die "Check out the '$BRANCH' branch first."
  git diff --quiet && git diff --cached --quiet || die "The working tree has uncommitted changes. Commit or stash them first."
  rebase_in_progress && die "A rebase is already in progress. Use --continue or git rebase --abort."

  step "Fetching upstream"
  git fetch origin --tags
  git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || die "Unknown ref: $REF"

  backup_tag="custom-backup/$(date +%Y%m%d-%H%M%S)"
  git tag "$backup_tag"
  old_base="$(git merge-base HEAD "$REF")"
  {
    echo "backup=$backup_tag"
    echo "ref=$REF"
    echo "old_base=$old_base"
  } > "$STATE_FILE"
  echo "Saved the current state as tag $backup_tag"

  step "Replaying customizations onto $REF ($(git rev-parse --short "$REF"))"
  git config rerere.enabled true
  git rebase --onto "$REF" "$old_base" "$BRANCH" || { conflict_help; exit 1; }
fi

backup_tag="$(sed -n 's/^backup=//p' "$STATE_FILE")"
REF="$(sed -n 's/^ref=//p' "$STATE_FILE")"
old_base="$(sed -n 's/^old_base=//p' "$STATE_FILE")"
new_base="$(git merge-base HEAD "$REF")"

if [[ "$BUILD" == true ]]; then
  if ! git diff --quiet "$old_base" "$new_base" -- package-lock.json || [[ ! -d node_modules ]]; then
    step "Upstream dependencies changed: npm ci"
    npm ci
  fi
  custom/build.sh
  if [[ "$VERIFY" == true ]]; then
    step "Running the panel smoke test"
    node custom/smoke-test.mjs
  fi
fi

step "Recording the update in custom/UPDATE-LOG.md"
{
  echo
  echo "## $(date '+%Y-%m-%d %H:%M')"
  echo
  echo "- Upstream: \`$(git rev-parse --short "$old_base")\` → \`$(git rev-parse --short "$new_base")\` ($REF, floccus $(node -p "require('./package.json').version"))"
  echo "- Upstream commits pulled: $(git rev-list --count "$old_base..$new_base")"
  echo "- Backup tag: \`$backup_tag\`"
  echo "- Customizations replayed:"
  git log --reverse --format='  - `%h` %s' "$new_base..HEAD"
} >> "$LOG_FILE"
git add custom/UPDATE-LOG.md
git commit --quiet --fixup "$(git log --format=%h -1 --grep='^custom: fork workflow' "$new_base..HEAD")" \
  || warn "Could not attach the log entry to the workflow commit; it stays as its own commit."
GIT_SEQUENCE_EDITOR=true git rebase --quiet --autosquash "$new_base" || die "Folding the log entry failed; finish with git rebase --continue."

if [[ "$PUSH" == true ]]; then
  step "Backing up $BRANCH to $BACKUP_REMOTE"
  git push --force-with-lease "$BACKUP_REMOTE" "$BRANCH" || warn "Push failed; run: git push --force-with-lease $BACKUP_REMOTE $BRANCH"
fi

rm -f "$STATE_FILE"
step "Done"
echo "Reload the extension in brave://extensions (or chrome://extensions) to pick up the build."
