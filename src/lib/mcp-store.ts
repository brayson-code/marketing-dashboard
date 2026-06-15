// MCP HUB store — per-tenant remote MCP servers that the tenant's agents can use
// via the Anthropic Messages API MCP connector (server-side tool discovery +
// execution, like web_search). One row per connected server.
//
// The bearer token (when a server needs one) is encrypted at rest with the SAME
// AES-256-GCM-under-the-shared-secret scheme as client_integrations — we reuse
// encryptSecret/decryptSecret from integrations-store rather than inventing new
// crypto. Every query is scoped to tenantId() (the backend postgres role bypasses
// RLS, so app-level scoping is the real isolation boundary).

import { sql, tenantId } from './db/client';
import { encryptSecret, decryptSecret } from './integrations-store';

export interface McpServerRow {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  has_auth: boolean;
  created_at: number;
}

/** What gets passed to the Anthropic Messages API `mcp_servers` param (decrypted). */
export interface McpServerConnector {
  name: string;
  url: string;
  authorization_token?: string;
}

interface RawRow {
  id: number;
  name: string;
  url: string;
  auth_token: string | null;
  enabled: boolean;
  created_at: Date | string;
}

function toEpochSeconds(v: Date | string): number {
  return Math.floor(new Date(v).getTime() / 1000);
}

// Masked hydration — NEVER returns the token (or its ciphertext) to callers/UI.
function hydrate(row: RawRow): McpServerRow {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    has_auth: !!row.auth_token,
    created_at: toEpochSeconds(row.created_at),
  };
}

/** List this tenant's MCP servers (tokens masked — only a has_auth flag). */
export async function listMcpServers(): Promise<McpServerRow[]> {
  const rows = (await sql()`
    SELECT id, name, url, auth_token, enabled, created_at
    FROM mcp_servers
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC, id DESC
  `) as unknown as RawRow[];
  return rows.map(hydrate);
}

/** Add a server (disabled by default). Token, if given, is encrypted at rest. */
export async function addMcpServer(input: {
  name: string;
  url: string;
  authToken?: string | null;
}): Promise<McpServerRow> {
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name) throw new Error('name is required');
  // The Anthropic MCP connector requires HTTPS — reject http:// at the door so a
  // tenant can't add a server that the API will refuse.
  if (!/^https:\/\//i.test(url)) throw new Error('url must be an https URL');
  const token = input.authToken?.trim();
  const encrypted = token ? encryptSecret(token) : null;
  const rows = (await sql()`
    INSERT INTO mcp_servers (tenant_id, name, url, auth_token, enabled)
    VALUES (${tenantId()}, ${name}, ${url}, ${encrypted}, false)
    RETURNING id, name, url, auth_token, enabled, created_at
  `) as unknown as RawRow[];
  return hydrate(rows[0]);
}

/** Toggle a server on/off. Tenant-scoped — a foreign id is a no-op. */
export async function setMcpServerEnabled(id: number, enabled: boolean): Promise<McpServerRow | null> {
  const rows = (await sql()`
    UPDATE mcp_servers
       SET enabled = ${enabled}
     WHERE id = ${id} AND tenant_id = ${tenantId()}
    RETURNING id, name, url, auth_token, enabled, created_at
  `) as unknown as RawRow[];
  return rows[0] ? hydrate(rows[0]) : null;
}

/** Remove a server. Tenant-scoped. */
export async function deleteMcpServer(id: number): Promise<void> {
  await sql()`
    DELETE FROM mcp_servers
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
}

/**
 * The connector list passed to the Anthropic Messages API for THIS tenant —
 * only enabled rows, with the auth token decrypted. Empty array (the common
 * case) means the agent calls must stay byte-identical to today: callers MUST
 * skip the mcp_servers param + beta header entirely when this returns [].
 *
 * Never throws — a decrypt failure on one row drops just that row's token
 * (the server is still offered, unauthenticated) rather than breaking the run.
 */
export async function enabledMcpServers(): Promise<McpServerConnector[]> {
  const rows = (await sql()`
    SELECT id, name, url, auth_token, enabled, created_at
    FROM mcp_servers
    WHERE tenant_id = ${tenantId()} AND enabled = true
    ORDER BY created_at ASC, id ASC
  `) as unknown as RawRow[];
  return rows.map((r) => {
    const conn: McpServerConnector = { name: r.name, url: r.url };
    if (r.auth_token) {
      try { conn.authorization_token = decryptSecret(r.auth_token); }
      catch { /* drop the token; offer the server unauthenticated rather than fail */ }
    }
    return conn;
  });
}

/**
 * Cheap boolean: does this tenant have >=1 enabled MCP server? Used as the
 * feature flag at the agent-call boundary so the no-server path is a single
 * indexed count, not a decrypt of every row.
 */
export async function mcpConfigured(): Promise<boolean> {
  try {
    const rows = (await sql()`
      SELECT 1 FROM mcp_servers
      WHERE tenant_id = ${tenantId()} AND enabled = true
      LIMIT 1
    `) as unknown as Array<{ '?column?': number }>;
    return rows.length > 0;
  } catch {
    return false;
  }
}
