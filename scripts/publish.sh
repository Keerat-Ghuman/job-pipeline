#!/bin/bash
# scripts/publish.sh
# Copies this project's committed files into a separate clone of your public
# repo, checks them against your private blocklist, proves a fresh install
# works (scripts/check-fresh.sh), and pushes one commit.
# Your private files (.env.local, credentials/, resume, applyKit.json) are
# gitignored, so they are never part of what gets copied.
#
#   ./scripts/publish.sh ~/Projects/job-pipeline-public "What changed"
#   DRY=1 ./scripts/publish.sh /tmp/scratch "x"   # build and check only: no commit, no push
#
# .publish-blocklist (gitignored, one phrase per line) lists personal details
# that must never be published: your name, phone, email, sheet ID.

set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:?usage: publish.sh <public clone dir> <message>}"
MSG="${2:?usage: publish.sh <public clone dir> <message>}"

if [ -n "${DRY:-}" ]; then
  # A dry run only builds into a new or empty folder: it empties it first.
  [ ! -d "$DEST" ] || [ -z "$(ls -A "$DEST")" ] || { echo "DRY needs a new or empty folder, and $DEST has files in it."; exit 1; }
  mkdir -p "$DEST"
  [ -d "$DEST/.git" ] || git -C "$DEST" init -q
else
  [ -d "$DEST/.git" ] || { echo "$DEST is not a git clone"; exit 1; }
fi
[ -z "$(git -C "$SRC" status --porcelain)" ] || { echo "Commit your changes first."; exit 1; }

find "$DEST" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$SRC" archive HEAD | tar -x -C "$DEST"

if [ -f "$SRC/.publish-blocklist" ]; then
  if grep -r -i -l -F -f "$SRC/.publish-blocklist" "$DEST" --exclude-dir=.git; then
    echo "Stopped: the files above contain something from .publish-blocklist."
    git -C "$DEST" checkout -- . && git -C "$DEST" clean -fdq
    exit 1
  fi
fi

echo "Checking that a fresh install works..."
if ! "$SRC/scripts/check-fresh.sh" "$DEST"; then
  echo "Stopped: a fresh install of this version fails. Nothing was published."
  git -C "$DEST" checkout -- . && git -C "$DEST" clean -fdq
  exit 1
fi

if [ -n "${DRY:-}" ]; then
  echo "Dry run: the checked copy is in $DEST. Nothing was committed or pushed."
  exit 0
fi

git -C "$DEST" add -A
if git -C "$DEST" diff --cached --quiet; then
  echo "Nothing new to publish."
  exit 0
fi
git -C "$DEST" commit -q -m "$MSG"
git -C "$DEST" push -q
echo "Published: $(git -C "$DEST" log --oneline -1)"
