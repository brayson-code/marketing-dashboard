#!/usr/bin/env bash
# docs-sync — after a production deploy, spin up a headless Claude agent to DRAFT
# documentation updates for whatever shipped since the last successful sync.
#
# It edits files under ./docs (and registers new pages in src/lib/docs-nav.ts)
# but NEVER commits — you review the working-tree diff and commit when happy.
# Invoked automatically by scripts/deploy-prod.sh; also runnable via `pnpm docs:sync`.
#
# State: .docs-sync-last-sha (gitignored) holds the last commit we drafted docs
# for, so each run only looks at the new range. We only advance it on success,
# so a failed run is retried (with the accumulated range) on the next deploy.
set -uo pipefail
cd "$(dirname "$0")/.."

STATE=".docs-sync-last-sha"
HEAD_SHA="$(git rev-parse HEAD)"

if ! command -v claude >/dev/null 2>&1; then
  echo "[docs-sync] 'claude' CLI not found on PATH — skipping doc drafting."
  exit 0
fi

LAST_SHA=""
[ -f "$STATE" ] && LAST_SHA="$(tr -d '[:space:]' < "$STATE")"

# No usable baseline → record HEAD and bail; next deploy will have a range.
if [ -z "$LAST_SHA" ] || ! git cat-file -e "${LAST_SHA}^{commit}" 2>/dev/null; then
  echo "$HEAD_SHA" > "$STATE"
  echo "[docs-sync] baseline set at ${HEAD_SHA:0:7} — nothing to document yet."
  exit 0
fi

if [ "$LAST_SHA" = "$HEAD_SHA" ]; then
  echo "[docs-sync] no new commits since last sync — skipping."
  exit 0
fi

RANGE="${LAST_SHA}..${HEAD_SHA}"
LOG="$(git log --oneline "$RANGE")"
STAT="$(git diff --stat "$RANGE" -- src/ docs/)"
# Cap the diff so a large release can't blow up context / token cost.
DIFF="$(git diff "$RANGE" -- src/ | head -c 180000)"
COUNT="$(git rev-list --count "$RANGE")"

echo "[docs-sync] drafting docs for ${COUNT} commit(s) in ${RANGE} …"

read -r -d '' PROMPT <<EOF || true
You are the docs-keeper for the KeyPlayers Command Center — a Next.js marketing
dashboard. The changes below just shipped to PRODUCTION. Update the public docs
so they stay accurate.

RULES
- Docs live in ./docs/*.md (plain markdown, first line is an H1 title). The public
  navigation is the DOCS_NAV array in src/lib/docs-nav.ts — a NEW doc page must be
  added there or it will not appear in the site.
- Document ONLY user-facing / behavioral changes: new pages, features, flows,
  settings, or changed behavior. IGNORE internal refactors, type changes, tests,
  dependency bumps, and chores.
- Prefer editing an existing doc in place when a feature changed. Create a new
  ./docs/<slug>.md only for a genuinely new feature area, and register it in
  DOCS_NAV with a short blurb.
- Match the voice, length, and structure of the existing docs. Be concise and
  task-oriented. Describe how to USE the feature, not how it's implemented.
- DO NOT run git. DO NOT commit or push. Leave every change uncommitted in the
  working tree for a human to review.
- If nothing user-facing changed, make no edits and say so in one line.

COMMITS
$LOG

CHANGED FILES
$STAT

DIFF (truncated to 180k chars)
$DIFF
EOF

# Pipe the prompt via stdin (not argv) — a big diff easily exceeds the OS
# command-line length limit ("Argument list too long").
if printf '%s' "$PROMPT" | claude -p --permission-mode acceptEdits; then
  echo "$HEAD_SHA" > "$STATE"
  echo "[docs-sync] done. Review the changes under ./docs (git status) and commit when ready."
else
  echo "[docs-sync] agent run failed — leaving baseline at ${LAST_SHA:0:7} so the next deploy retries the range."
fi
