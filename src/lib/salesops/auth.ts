// SalesOps token auth — the bearer-secret model the browser extension authenticates
// with. The extension runs on meet/zoom/teams/webex and can't carry our Supabase session
// cookie, so the /api/salesops/* routes self-authenticate with a per-tenant token (same
// shape as the webhook-secret model).
//
// SECURITY:
//   - The raw token ("sk_sops_" + 32 random bytes, base64url) is shown to the rep ONCE at
//     creation and NEVER stored. We persist only its SHA-256 hex hash.
//   - resolveSalesopsToken() runs OUTSIDE tenant context: it hashes the bearer token and
//     looks the hash up GLOBALLY (token_hash is unique across tenants), then returns the
//     owning tenant's context for the route to enter. The raw token is never logged.
//   - The management helpers (create/list/revoke) are tenant-scoped: they run INSIDE the
//     owner's session context and use tenantId()/currentUserId().

import { createHash, randomBytes } from 'node:crypto';
import { sql } from '@/lib/db/client';
import { tenantId, currentUserId, type TenantContext } from '@/lib/tenant';

const TOKEN_PREFIX = 'sk_sops_';

/** SHA-256 hex of a string. Used to hash tokens before storage/lookup. */
function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Generate a fresh raw SalesOps token. Format: "sk_sops_" + base64url(32 random bytes). */
function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export interface SalesopsTokenRow {
  id: string;
  label: string | null;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}

/**
 * Mint a new SalesOps token for the CURRENT tenant. Returns the raw token ONCE (the
 * caller must surface it to the rep immediately — it is not recoverable). Only the hash
 * is persisted. Tenant-scoped: requires an active owner/session tenant context.
 */
export async function createSalesopsToken(input: { label?: string }): Promise<{ id: string; token: string }> {
  const raw = generateRawToken();
  const hash = sha256hex(raw);
  const rows = (await sql()`
    INSERT INTO salesops_tokens (tenant_id, token_hash, label, created_by)
    VALUES (${tenantId()}, ${hash}, ${input.label ?? null}, ${currentUserId()})
    RETURNING id
  `) as unknown as { id: string }[];
  return { id: rows[0].id, token: raw };
}

/**
 * List the CURRENT tenant's SalesOps tokens — WITHOUT the hashes (never returned to the
 * client). Newest first. Tenant-scoped.
 */
export async function listSalesopsTokens(): Promise<SalesopsTokenRow[]> {
  const rows = (await sql()`
    SELECT id, label, created_at, last_used_at, revoked_at
    FROM salesops_tokens
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC
  `) as unknown as SalesopsTokenRow[];
  return rows;
}

/**
 * Revoke a SalesOps token by id (soft-delete via revoked_at). Tenant-scoped — the
 * tenant_id filter prevents revoking another workspace's token. Idempotent.
 */
export async function revokeSalesopsToken(id: string): Promise<void> {
  await sql()`
    UPDATE salesops_tokens
    SET revoked_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()} AND revoked_at IS NULL
  `;
}

/**
 * Authenticate an extension-facing request from its Authorization: Bearer token.
 * Returns the owning tenant's context, or null when the token is absent/unknown/revoked.
 *
 * Runs OUTSIDE tenant context on purpose: token_hash is globally unique, so the lookup is
 * safe without a tenant filter and is exactly how we DISCOVER which tenant to enter. The
 * route then calls enterTenant(ctx) before any tenant-scoped query. The raw token is
 * never logged.
 */
export async function resolveSalesopsToken(req: Request): Promise<TenantContext | null> {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const raw = header.replace(/^Bearer\s+/i, '').trim();
  if (!raw) return null;

  const hash = sha256hex(raw);
  const rows = (await sql()`
    SELECT id, tenant_id, created_by
    FROM salesops_tokens
    WHERE token_hash = ${hash} AND revoked_at IS NULL
    LIMIT 1
  `) as unknown as { id: string; tenant_id: string; created_by: string | null }[];

  const row = rows[0];
  if (!row) return null;

  // Best-effort last-used touch — never blocks auth, never throws into the request.
  void sql()`
    UPDATE salesops_tokens SET last_used_at = now() WHERE id = ${row.id}
  `.catch(() => {});

  return { tenantId: row.tenant_id, userId: row.created_by };
}
