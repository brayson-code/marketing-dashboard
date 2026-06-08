#!/usr/bin/env bash
# Production deploy + automatic docs drafting.
#
# Use this (or `pnpm deploy`) INSTEAD of a bare `vercel deploy --prod`, so the
# docs-keeper agent runs against whatever just shipped and drafts documentation
# updates for review. Extra args are passed through to the Vercel CLI.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "[deploy] production deploy starting…"
if vercel deploy --prod --yes "$@"; then
  echo "[deploy] live. Drafting doc updates for review…"
  bash scripts/docs-sync.sh || echo "[deploy] docs-sync had an issue (non-fatal) — the deploy is live."
else
  echo "[deploy] deploy FAILED — skipping docs-sync."
  exit 1
fi
