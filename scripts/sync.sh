#!/bin/bash
# scripts/sync.sh
# Moves finished work on main to the other two versions, in order:
#   1. tests main
#   2. merges main into the hosted branch (its worktree) and tests it
#   3. publishes main to the public clone with scripts/publish.sh
# It stops at the first failure. A version whose folder is missing is skipped.
#
#   ./scripts/sync.sh "What changed"
#
# Folders default to ../Job-pipeline-hosted and ../job-pipeline-public.
# Set JOBPIPELINE_HOSTED_DIR or JOBPIPELINE_PUBLIC_DIR to use others.

set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
HOSTED="${JOBPIPELINE_HOSTED_DIR:-$SRC/../Job-pipeline-hosted}"
PUBLIC="${JOBPIPELINE_PUBLIC_DIR:-$SRC/../job-pipeline-public}"
MSG="${1:?usage: sync.sh <what changed>}"

clean() { [ -z "$(git -C "$1" status --porcelain)" ] || { echo "Stopped: $1 has uncommitted changes. Commit them first."; exit 1; }; }

[ "$(git -C "$SRC" branch --show-current)" = main ] || { echo "Stopped: run this from main. Merge your branch into main first."; exit 1; }
clean "$SRC"

echo "1/3 Testing main..."
(cd "$SRC" && npm test --silent > /dev/null) || { echo "Stopped: main's tests fail. Run npm test to see why."; exit 1; }

if [ -d "$HOSTED" ]; then
  echo "2/3 Merging main into hosted..."
  clean "$HOSTED"
  [ "$(git -C "$HOSTED" branch --show-current)" = hosted ] || { echo "Stopped: $HOSTED is not on the hosted branch."; exit 1; }
  if ! git -C "$HOSTED" merge --no-edit main; then
    echo "Stopped: the merge conflicts. Resolve it in $HOSTED (keep hosted's data layer, main's UI and wording),"
    echo "run npm test there, commit, then run this again."
    exit 1
  fi
  (cd "$HOSTED" && npm test --silent > /dev/null) || { echo "Stopped: hosted's tests fail after the merge. Fix them in $HOSTED and commit."; exit 1; }
else
  echo "2/3 Skipped: no hosted folder at $HOSTED"
fi

if [ -d "$PUBLIC/.git" ]; then
  echo "3/3 Publishing..."
  "$SRC/scripts/publish.sh" "$PUBLIC" "$MSG"
else
  echo "3/3 Skipped: no public clone at $PUBLIC"
fi
echo "Done."
