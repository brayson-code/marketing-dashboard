// Server-only Nango social-OAuth integration layer.
//
// Wraps @nangohq/node (v0.70.4) for the KeyPlayers Command Center. Everything here
// degrades gracefully when NANGO_SECRET_KEY is UNSET — no throw at import, no crash
// at request time. Callers should treat a null/empty result as "not configured yet".
//
// Multi-tenant: our convention is connection_id == tenant_id, and Nango's end_user.id
// is also the tenant. Every DB query scopes to tenantId() since the postgres role
// bypasses RLS (see src/lib/db/client.ts header).

import { Nango } from '@nangohq/node';
import { sql, jsonb } from '@/lib/db/client';
import { tenantId } from '@/lib/tenant';

export interface ProviderDef {
  key: string;
  label: string;
  providerConfigKey: string;
}

export interface ProviderStatus {
  key: string;
  label: string;
  connected: boolean;
  connected_at: string | null;
}

/**
 * The social providers we support. `providerConfigKey` is the Nango integration id;
 * it defaults to the provider key but can be overridden per-provider via
 * `NANGO_<KEY>_CONFIG_KEY` (e.g. NANGO_YOUTUBE_CONFIG_KEY) since the id configured in
 * the Nango dashboard may differ from our internal key.
 */
function configKey(key: string): string {
  return process.env[`NANGO_${key.toUpperCase()}_CONFIG_KEY`] || key;
}

export const PROVIDERS: ProviderDef[] = [
  { key: 'youtube', label: 'YouTube', providerConfigKey: configKey('youtube') },
  { key: 'linkedin', label: 'LinkedIn', providerConfigKey: configKey('linkedin') },
  { key: 'instagram', label: 'Instagram', providerConfigKey: configKey('instagram') },
  { key: 'facebook', label: 'Facebook', providerConfigKey: configKey('facebook') },
  { key: 'x', label: 'X', providerConfigKey: configKey('x') },
];

/** True only when the Nango secret key is present in the environment. */
export function isNangoConfigured(): boolean {
  return !!process.env.NANGO_SECRET_KEY;
}

/** A configured Nango admin client, or null if the secret key is unset. */
export function getNango(): Nango | null {
  if (!isNangoConfigured()) return null;
  return new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
}

/** Map a provider key to its (possibly overridden) Nango integration id. */
export function providerConfigKeyFor(key: string): string {
  return PROVIDERS.find((p) => p.key === key)?.providerConfigKey ?? configKey(key);
}

/**
 * Mint a Connect session token for the frontend Connect UI. The token scopes the
 * session to this tenant (end_user.id) and to our supported integrations only.
 * Returns null if Nango is unconfigured or the call fails.
 */
export async function createConnectSessionToken(tenant: string): Promise<string | null> {
  const nango = getNango();
  if (!nango) return null;
  try {
    const res = await nango.createConnectSession({
      end_user: { id: tenant },
      allowed_integrations: PROVIDERS.map((p) => p.providerConfigKey),
    });
    return res?.data?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Status of every supported provider for the current tenant: each provider always
 * appears, with `connected` true/false based on our `connections` table. This reads
 * only our DB (no Nango call) so it works even when Nango is unconfigured.
 */
export async function listProviderStatus(): Promise<ProviderStatus[]> {
  let connectedMap = new Map<string, string | null>();
  try {
    const rows = (await sql()`
      SELECT provider, connected_at, status
      FROM connections
      WHERE tenant_id = ${tenantId()}
    `) as unknown as Array<{ provider: string; connected_at: Date | string | null; status: string }>;
    for (const r of rows) {
      if (r.status === 'connected') {
        connectedMap.set(
          r.provider,
          r.connected_at instanceof Date ? r.connected_at.toISOString() : (r.connected_at as string | null),
        );
      }
    }
  } catch {
    // DB unavailable (e.g. SUPABASE_DB_URL unset) — degrade to all-disconnected.
    connectedMap = new Map();
  }

  return PROVIDERS.map((p) => ({
    key: p.key,
    label: p.label,
    connected: connectedMap.has(p.key),
    connected_at: connectedMap.get(p.key) ?? null,
  }));
}

/**
 * Upsert a connection record for the current tenant after a successful OAuth flow.
 * Idempotent on (tenant_id, provider).
 */
export async function recordConnection(
  provider: string,
  connectionId: string,
  providerConfigKey: string,
): Promise<void> {
  await sql()`
    INSERT INTO connections (tenant_id, provider, provider_config_key, connection_id, status, connected_at)
    VALUES (${tenantId()}, ${provider}, ${providerConfigKey}, ${connectionId}, 'connected', now())
    ON CONFLICT (tenant_id, provider) DO UPDATE
      SET provider_config_key = EXCLUDED.provider_config_key,
          connection_id = EXCLUDED.connection_id,
          status = 'connected',
          metadata = COALESCE(connections.metadata, ${jsonb({})}),
          connected_at = now()
  `;
}

/**
 * Remove a provider connection for the current tenant. Deletes our row, and makes a
 * best-effort call to Nango to delete the upstream connection (failures are swallowed
 * so disconnecting never errors just because Nango is down/unconfigured).
 */
export async function disconnect(provider: string): Promise<void> {
  const rows = (await sql()`
    SELECT provider_config_key, connection_id
    FROM connections
    WHERE tenant_id = ${tenantId()} AND provider = ${provider}
  `) as unknown as Array<{ provider_config_key: string | null; connection_id: string | null }>;

  await sql()`
    DELETE FROM connections
    WHERE tenant_id = ${tenantId()} AND provider = ${provider}
  `;

  const nango = getNango();
  const row = rows[0];
  if (nango && row?.connection_id) {
    try {
      await nango.deleteConnection(
        row.provider_config_key || providerConfigKeyFor(provider),
        row.connection_id,
      );
    } catch {
      // Best-effort: our row is already gone; ignore upstream cleanup failures.
    }
  }
}
