// Shared helpers for the TEST-ENVIRONMENT seeding tools (seed-test-env.ts +
// provision-demo-client.ts). This file exists ONLY to keep the security-sensitive
// GoTrue auth-row construction in ONE place so the two scripts can never drift.
//
// TEST-ONLY. The fresh TEST Supabase project (ref dgcanicamgdeqehnvcmc) has NO
// service-role key, so we cannot use `admin.auth.admin.createUser`. Instead we
// create/repair auth users with DIRECT SQL into auth.users + auth.identities,
// mirroring how GoTrue lays those rows out, so email+password login works.
//
// Every write goes through the repo's own postgres.js client (src/lib/db/client),
// which reads SUPABASE_DB_URL — the same connection every app lib helper uses.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql, jsonb } from '../../src/lib/db/client';

// ── Hard test-project guard ──────────────────────────────────────────────────

/** The ONLY project these tools may ever touch. Positive allow-list — the guard
 *  REQUIRES this ref in SUPABASE_DB_URL, so any other database (including prod) is
 *  refused without ever naming it here. */
export const TEST_PROJECT_REF = 'dgcanicamgdeqehnvcmc';

/** Refuse to run unless SUPABASE_DB_URL points at the TEST project. Loud + exit 1. */
export function assertTestProject(): void {
  const dbUrl = process.env.SUPABASE_DB_URL ?? '';
  if (!dbUrl) {
    console.error('\nREFUSING TO RUN: SUPABASE_DB_URL is not set.');
    console.error('Run with: npx tsx --env-file=.env.test.local scripts/<name>.ts\n');
    process.exit(1);
  }
  if (!dbUrl.includes(TEST_PROJECT_REF)) {
    console.error(`\nREFUSING TO RUN: SUPABASE_DB_URL must point at the TEST project (${TEST_PROJECT_REF}).`);
    console.error('This is a TEST-ONLY seeding tool. It will not run against any other database.');
    console.error('Run with: npx tsx --env-file=.env.test.local scripts/<name>.ts\n');
    process.exit(1);
  }
}

// ── Small utilities ───────────────────────────────────────────────────────────

export function isUuid(s: string | undefined | null): boolean {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Read a required env var or exit 1 (never prints the value). */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`Missing required env var ${name} — set it in .env.test.local.`);
    process.exit(1);
  }
  return v;
}

// ── pgcrypto (bcrypt password hashing done in the DB) ─────────────────────────
//
// GoTrue verifies bcrypt ($2a$…) password hashes. pgcrypto's
// crypt(password, gen_salt('bf')) produces exactly that, so a row we write logs
// in like a real GoTrue signup. pgcrypto lives in whatever schema Supabase put it
// (usually `extensions`); we resolve it rather than assume the search_path.

/** Ensure pgcrypto is available and return the schema that owns gen_salt/crypt. */
export async function ensurePgcryptoSchema(): Promise<string> {
  const s = sql();
  const find = async () =>
    (await s`
      SELECT n.nspname AS schema
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'gen_salt' LIMIT 1
    `) as unknown as Array<{ schema: string }>;

  let schema = (await find())[0]?.schema;
  if (!schema) {
    // Install into Supabase's conventional extensions schema, then re-resolve.
    await s.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions');
    schema = (await find())[0]?.schema;
  }
  if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
    throw new Error('pgcrypto (crypt/gen_salt) is unavailable — cannot hash passwords for auth.users.');
  }
  return schema;
}

/** Compute a bcrypt hash for `plain` using pgcrypto in `schema`. */
export async function bcryptHash(plain: string, schema: string): Promise<string> {
  // `schema` is validated in ensurePgcryptoSchema; `plain` is a bound parameter.
  const rows = (await sql().unsafe(
    `SELECT ${schema}.crypt($1, ${schema}.gen_salt('bf')) AS hash`,
    [plain],
  )) as unknown as Array<{ hash: string }>;
  const hash = rows[0]?.hash;
  if (!hash) throw new Error('pgcrypto returned no hash.');
  return hash;
}

// ── Auth users (direct SQL — no service-role) ─────────────────────────────────

export interface EnsureAuthUserResult {
  userId: string;
  created: boolean;
}

/**
 * Create (or repair) a password-login auth user via direct SQL, mirroring GoTrue's
 * row layout. Idempotent by email: reuses the existing user and refreshes its
 * password + app metadata. Always ensures a matching auth.identities(provider=email)
 * row so the session resolves an identity on login.
 *
 * raw_app_meta_data gets { provider: 'email', providers: ['email'] } here; the
 * tenant_id claim is stamped separately (stampTenantClaim) once the tenant exists.
 */
// The TEST project's `auth` schema is OWNER-LOCKED (only supabase_auth_admin can
// grant on it), so kc_test_app can never touch auth.users/auth.identities. Instead:
// user ids are DETERMINISTIC (md5(email) as a uuid — stable across reruns), and the
// auth INSERT/UPDATE statements are APPENDED to scripts/out/auth-seed.sql for the
// coordinator to apply via the Supabase MCP's privileged connection.

const AUTH_SQL_PATH = join(__dirname, '..', 'out', 'auth-seed.sql');

/** md5(email) formatted as a UUID — deterministic, rerun-stable. */
export function deterministicUserId(email: string): string {
  const h = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function appendAuthSql(statement: string): void {
  mkdirSync(join(__dirname, '..', 'out'), { recursive: true });
  appendFileSync(AUTH_SQL_PATH, statement.trim() + '\n\n', 'utf8');
}

export async function ensureAuthUser(opts: {
  email: string;
  password: string;
  pgcryptoSchema: string;
}): Promise<EnsureAuthUserResult> {
  const email = opts.email.trim().toLowerCase();
  const userId = deterministicUserId(email);
  // bcrypt via DB pgcrypto (extensions schema IS granted to kc_test_app).
  const encrypted = await bcryptHash(opts.password, opts.pgcryptoSchema);
  const appMeta = JSON.stringify({ provider: 'email', providers: ['email'] });
  const identityData = JSON.stringify({ sub: userId, email, email_verified: true, phone_verified: false });

  appendAuthSql(`
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, phone_change, phone_change_token,
  is_sso_user, is_anonymous
) VALUES (
  '00000000-0000-0000-0000-000000000000', ${sqlLit(userId)}, 'authenticated', 'authenticated', ${sqlLit(email)},
  ${sqlLit(encrypted)}, now(),
  ${sqlLit(appMeta)}::jsonb, '{}'::jsonb,
  now(), now(),
  '', '', '', '',
  '', '', '', '',
  false, false
)
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
  raw_app_meta_data  = COALESCE(auth.users.raw_app_meta_data, '{}'::jsonb) || EXCLUDED.raw_app_meta_data,
  updated_at         = now();

INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) VALUES (
  ${sqlLit(userId)}, ${sqlLit(userId)}, ${sqlLit(identityData)}::jsonb, 'email',
  now(), now(), now()
)
ON CONFLICT (provider_id, provider) DO NOTHING;`);

  console.log(`  auth SQL for ${email} appended to scripts/out/auth-seed.sql (apply via MCP, then DELETE the file — it embeds a credential hash).`);
  return { userId, created: true };
}

/** Stamp app_metadata.tenant_id onto a user's JWT claim (merge, don't clobber). */
export async function stampTenantClaim(userId: string, tenantId: string): Promise<void> {
  appendAuthSql(`
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || ${sqlLit(JSON.stringify({ tenant_id: tenantId }))}::jsonb,
    updated_at = now()
WHERE id = ${sqlLit(userId)};`);
}

/** Deterministic id by email (no auth-schema read — see header note). */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  return deterministicUserId(email);
}

// ── Tenants / membership ──────────────────────────────────────────────────────

/** Owner/member/va membership row, idempotent on (workspace_id, user_id). */
export async function ensureMembership(
  tenantId: string,
  userId: string,
  role: 'owner' | 'member' | 'va',
): Promise<void> {
  await sql()`
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (${tenantId}, ${userId}, ${role})
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;
}

/** Resolve a tenant id by an exact name (oldest first), or null. */
export async function tenantIdByName(name: string): Promise<string | null> {
  const rows = (await sql()`
    SELECT id::text AS id FROM public.tenants WHERE name = ${name} ORDER BY created_at ASC LIMIT 1
  `) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** Resolve a tenant id by business_profile.demo_slug (the demo idempotency key), or null. */
export async function tenantIdByDemoSlug(slug: string): Promise<string | null> {
  const rows = (await sql()`
    SELECT id::text AS id FROM public.tenants WHERE business_profile->>'demo_slug' = ${slug} LIMIT 1
  `) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** Merge a patch into tenants.business_profile without clobbering the rest. */
export async function mergeBusinessProfile(tenantId: string, patch: Record<string, unknown>): Promise<void> {
  await sql()`
    UPDATE public.tenants
    SET business_profile = COALESCE(business_profile, '{}'::jsonb) || ${jsonb(patch)}
    WHERE id = ${tenantId}
  `;
}

/**
 * If a tenant has no agent_defs rows, call public.seed_org_chart to copy the HQ
 * org chart. Best-effort: on a fresh TEST DB the seed source (the hardcoded HQ id
 * fff35ccb… inside the function) is empty, so this is often a no-op and the app
 * falls back to the bundled agents/** files. Returns the final agent_defs count.
 */
export async function seedOrgChartIfEmpty(tenantId: string): Promise<number> {
  const s = sql();
  const count = async () =>
    ((await s`SELECT count(*)::int AS n FROM public.agent_defs WHERE tenant_id = ${tenantId}`) as unknown as Array<{ n: number }>)[0]?.n ?? 0;

  if ((await count()) > 0) return count();
  try {
    await s`SELECT public.seed_org_chart(${tenantId}::uuid)`;
  } catch (e) {
    console.warn(`  [warn] seed_org_chart(${tenantId}) unavailable/failed (falling back to bundled agents): ${(e as Error).message}`);
  }
  return count();
}
