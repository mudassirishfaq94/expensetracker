#!/usr/bin/env bash
# =============================================================================
# git-push.sh — commit every change and push (use this on each future edit)
# Usage:  bash git-push.sh "describe what changed"
# =============================================================================
set -e
cd "$(dirname "$0")"
MSG="${1:-update: work in progress}"
git add -A
if git commit -m "$MSG"; then
  git push
  echo ">> Pushed: $MSG"
else
  echo ">> Nothing to commit."
fi
