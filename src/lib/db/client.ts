// Supabase Postgres connection for the backend (orchestrator, webhook, domain libs).
// Uses the postgres.js driver + Drizzle over the Supabase *transaction pooler*
// (port 6543), which is the serverless-safe connection mode on Vercel.
//
// Auth model: this connects as the `postgres` role, which BYPASSES Row-Level
// Security. Every query the backend runs MUST therefore filter by tenant_id
// itself — RLS is the safety net for the browser (anon key), not for this path.
//
// Lazy-initialized so importing this module never crashes at build time when
// SUPABASE_DB_URL is absent (e.g. during `next build`).

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

let _sql: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

// Tenant scoping is now REQUEST-SCOPED (multi-tenant). `tenantId()` returns the
// active request's workspace, or the system default outside a request (cron, jobs).
// Re-exported here so the many call sites that import the tenant from this module
// keep working after the flip from the old constant. Every backend query MUST still
// scope to tenantId(), since the postgres role bypasses RLS (see header note).
export { DEFAULT_TENANT_ID, tenantId } from '../tenant';

function connectionString(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      'SUPABASE_DB_URL is not set. Copy the Supabase "Transaction pooler" connection ' +
        'string into .env.local (see .env.supabase.example).',
    );
  }
  return url;
}

/** Raw postgres.js client — use `sql\`...\`` tagged templates for queries. */
export function sql() {
  if (!_sql) {
    // prepare:false is required for the transaction pooler (PgBouncer).
    _sql = postgres(connectionString(), { prepare: false });
  }
  return _sql;
}

/** Drizzle instance over the same pooled connection. */
export function db() {
  if (!_db) _db = drizzle(sql());
  return _db;
}

/**
 * Wrap a plain JS value for insertion into a `jsonb` column.
 * Equivalent to `sql.json(value)` but accepts our app-level `unknown`/`Record`
 * shapes without fighting postgres.js's strict `JSONValue` parameter type.
 */
export function jsonb(value: unknown): ReturnType<ReturnType<typeof postgres>['json']> {
  return sql().json(value as Parameters<ReturnType<typeof postgres>['json']>[0]);
}
