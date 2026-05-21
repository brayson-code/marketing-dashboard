// LEGACY (neutralized for Supabase / Vercel).
//
// This module used to read Hermes session JSON files from a local state dir and
// upsert them into the better-sqlite3 database on a 30s interval. That model does
// not work on Vercel: there is no persistent local filesystem, and the data store
// is now Supabase Postgres (writes happen via the orchestrator / webhooks / API
// routes, not a file-poll loop).
//
// To keep `/api/sync` from crashing the serverless function (it imported the
// native sqlite module) the sync functions are now safe no-ops. The exported
// signatures are preserved so existing callers (src/app/api/sync/route.ts) keep
// type-checking and building. Re-introduce a real sync path later if needed.

export function startSync(): void {
  console.warn('[sync] startSync() is a no-op — file→SQLite sync is disabled on Supabase/Vercel.');
}

export function stopSync(): void {
  // no-op
}

export function syncAll(): void {
  console.warn('[sync] syncAll() is a no-op — file→SQLite sync is disabled on Supabase/Vercel.');
}
