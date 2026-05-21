import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { getDb } from './db';

/**
 * Per-client integration credentials. Secrets are encrypted at rest with
 * AES-256-GCM. The encryption key is derived from KEYPLAYERS_SECRETS_KEY env var
 * (or a hash of API_KEY as a dev fallback).
 *
 * The dashboard owner manages their own integrations; multi-tenant scoping
 * (per-client integrations) is a future enhancement — for now there's one row
 * per provider globally.
 */

export type IntegrationStatus = 'not_configured' | 'configured' | 'expired' | 'error';

export interface IntegrationProviderDef {
  id: string;
  label: string;
  category: 'ai' | 'messaging' | 'email' | 'calendar' | 'social' | 'analytics' | 'crm' | 'storage' | 'other';
  fields: Array<{ name: string; label: string; type: 'text' | 'password' | 'url'; required?: boolean; placeholder?: string }>;
  scopesHint?: string;
}

export interface IntegrationRow {
  id: number;
  provider: string;
  label: string | null;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  has_secret: boolean;
  scopes: string | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
  last_error: string | null;
}

export const PROVIDERS: IntegrationProviderDef[] = [
  { id: 'anthropic', label: 'Anthropic (Claude API)', category: 'ai',
    fields: [{ name: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'sk-ant-…' }] },
  { id: 'openai', label: 'OpenAI', category: 'ai',
    fields: [{ name: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'sk-…' }] },
  { id: 'loopmessage', label: 'LoopMessage (iMessage)', category: 'messaging',
    fields: [
      { name: 'auth_key', label: 'Auth Key', type: 'password', required: true },
      { name: 'webhook_secret', label: 'Webhook Secret', type: 'password' },
      { name: 'sender_name', label: 'Sender Name', type: 'text' },
    ] },
  { id: 'gmail', label: 'Gmail', category: 'email', scopesHint: 'gmail.readonly, gmail.compose',
    fields: [
      { name: 'oauth_client_id', label: 'OAuth Client ID', type: 'text' },
      { name: 'oauth_client_secret', label: 'OAuth Client Secret', type: 'password' },
      { name: 'refresh_token', label: 'Refresh Token (after OAuth)', type: 'password' },
    ] },
  { id: 'google_calendar', label: 'Google Calendar', category: 'calendar', scopesHint: 'calendar.events',
    fields: [
      { name: 'oauth_client_id', label: 'OAuth Client ID', type: 'text' },
      { name: 'oauth_client_secret', label: 'OAuth Client Secret', type: 'password' },
      { name: 'refresh_token', label: 'Refresh Token (after OAuth)', type: 'password' },
    ] },
  { id: 'x', label: 'X (Twitter)', category: 'social',
    fields: [{ name: 'bearer_token', label: 'Bearer Token', type: 'password', required: true }] },
  { id: 'linkedin', label: 'LinkedIn', category: 'social',
    fields: [
      { name: 'access_token', label: 'Access Token', type: 'password', required: true },
      { name: 'organization_urn', label: 'Organization URN', type: 'text', placeholder: 'urn:li:organization:123' },
    ] },
  { id: 'instagram', label: 'Instagram (via Meta)', category: 'social',
    fields: [{ name: 'access_token', label: 'Page Access Token', type: 'password', required: true }] },
  { id: 'plausible', label: 'Plausible Analytics', category: 'analytics',
    fields: [
      { name: 'site_id', label: 'Site ID', type: 'text', required: true },
      { name: 'api_key', label: 'API Key', type: 'password' },
      { name: 'base_url', label: 'Base URL', type: 'url', placeholder: 'https://plausible.io' },
    ] },
  { id: 'ga4', label: 'Google Analytics 4', category: 'analytics',
    fields: [
      { name: 'property_id', label: 'Property ID', type: 'text', required: true },
      { name: 'service_account_json', label: 'Service Account JSON', type: 'password', required: true },
    ] },
  { id: 'hyperframes', label: 'HeyGen Hyperframes', category: 'storage',
    fields: [{ name: 'api_key', label: 'API Key', type: 'password', required: true }] },
];

// ── Crypto ──────────────────────────────────────────────────────────────────

function getKey(): Buffer {
  const raw = process.env.KEYPLAYERS_SECRETS_KEY || process.env.API_KEY || 'keyplayers-dev-fallback-do-not-use-in-prod';
  return createHash('sha256').update(raw).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(blob: string): string {
  const [ivB64, tagB64, encB64] = blob.split(':');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

// ── Public API ──────────────────────────────────────────────────────────────

interface RawRow {
  id: number; provider: string; label: string | null; status: IntegrationStatus;
  config: string | null; secret_encrypted: string | null; scopes: string | null;
  expires_at: number | null; created_at: number; updated_at: number; last_error: string | null;
}

function hydrate(row: RawRow): IntegrationRow {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    status: row.status,
    config: row.config ? JSON.parse(row.config) : {},
    has_secret: !!row.secret_encrypted,
    scopes: row.scopes,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_error: row.last_error,
  };
}

export function listIntegrations(): IntegrationRow[] {
  const rows = getDb().prepare(`SELECT * FROM client_integrations ORDER BY provider`).all() as RawRow[];
  return rows.map(hydrate);
}

export function getIntegration(provider: string): IntegrationRow | undefined {
  const row = getDb().prepare(`SELECT * FROM client_integrations WHERE provider = ?`).get(provider) as RawRow | undefined;
  return row ? hydrate(row) : undefined;
}

export function getDecryptedSecret(provider: string): Record<string, string> | null {
  const row = getDb().prepare(`SELECT secret_encrypted FROM client_integrations WHERE provider = ?`).get(provider) as { secret_encrypted: string | null } | undefined;
  if (!row?.secret_encrypted) return null;
  try {
    return JSON.parse(decrypt(row.secret_encrypted));
  } catch {
    return null;
  }
}

export function upsertIntegration(input: {
  provider: string;
  label?: string;
  config?: Record<string, unknown>;
  secret?: Record<string, string>; // fields like { api_key: '...', refresh_token: '...' }
  scopes?: string;
  expires_at?: number | null;
}): IntegrationRow {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM client_integrations WHERE provider = ?`).get(input.provider) as RawRow | undefined;

  const mergedConfig = { ...(existing?.config ? JSON.parse(existing.config) : {}), ...(input.config ?? {}) };
  let mergedSecret: Record<string, string> | null = null;
  if (existing?.secret_encrypted) {
    try { mergedSecret = JSON.parse(decrypt(existing.secret_encrypted)); } catch { mergedSecret = null; }
  }
  if (input.secret) {
    mergedSecret = { ...(mergedSecret ?? {}), ...input.secret };
  }

  const status: IntegrationStatus = mergedSecret && Object.keys(mergedSecret).length > 0 ? 'configured' : 'not_configured';
  const encryptedBlob = mergedSecret ? encrypt(JSON.stringify(mergedSecret)) : null;

  if (existing) {
    db.prepare(`
      UPDATE client_integrations
         SET label = COALESCE(?, label),
             status = ?,
             config = ?,
             secret_encrypted = ?,
             scopes = COALESCE(?, scopes),
             expires_at = COALESCE(?, expires_at),
             updated_at = unixepoch(),
             last_error = NULL
       WHERE id = ?
    `).run(input.label ?? null, status, JSON.stringify(mergedConfig), encryptedBlob, input.scopes ?? null, input.expires_at ?? null, existing.id);
    return getIntegration(input.provider)!;
  }
  db.prepare(`
    INSERT INTO client_integrations (provider, label, status, config, secret_encrypted, scopes, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.provider,
    input.label ?? null,
    status,
    JSON.stringify(mergedConfig),
    encryptedBlob,
    input.scopes ?? null,
    input.expires_at ?? null,
  );
  return getIntegration(input.provider)!;
}

export function clearIntegration(provider: string): void {
  getDb().prepare(`DELETE FROM client_integrations WHERE provider = ?`).run(provider);
}
