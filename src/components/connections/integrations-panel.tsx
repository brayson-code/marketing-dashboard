'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { KeyRound, CheckCircle2, AlertCircle, Check, X } from 'lucide-react';
import { BrandLogo } from '@/components/connections/brand-logo';

type Category = 'ai' | 'messaging' | 'email' | 'calendar' | 'social' | 'analytics' | 'crm' | 'storage' | 'other';

interface ProviderDef {
  id: string;
  label: string;
  category: Category;
  fields: Array<{ name: string; label: string; type: 'text' | 'password' | 'url'; required?: boolean; placeholder?: string }>;
  scopesHint?: string;
  comingSoon?: boolean;
  /** Redirect-based OAuth providers (e.g. Jobber) — see IntegrationProviderDef in
   * src/lib/integrations-store.ts for the full contract. Rendered by OAuthProviderTile
   * below instead of the generic paste-a-key form. */
  kind?: 'apikey' | 'oauth';
  connectPath?: string;
}

interface Integration {
  id: number;
  provider: string;
  label: string | null;
  status: 'not_configured' | 'configured' | 'expired' | 'error';
  config: Record<string, unknown>;
  has_secret: boolean;
  scopes: string | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
  last_error: string | null;
}

const CATEGORIES: Array<{ id: Category | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ai', label: 'AI' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'email', label: 'Email' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'social', label: 'Social' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'crm', label: 'CRM' },
  { id: 'storage', label: 'Other tools' },
];

interface OAuthStatus {
  /** Operator has set the platform-level env creds (e.g. JOBBER_CLIENT_ID/SECRET). */
  configured: boolean;
  /** This workspace has a stored token for the provider. */
  connected: boolean;
  account_name?: string | null;
}

/**
 * OAuthProviderTile — renders a redirect-based OAuth provider (currently just
 * Jobber). Unlike the generic paste-a-key tiles above, this fetches its own
 * connect/disconnect status from a per-provider route rather than the shared
 * /api/integrations-setup listing, and drives the OAuth handshake by navigating
 * the browser to `connectPath` (full-page redirect to the provider's authorize
 * screen, same pattern as the Stripe checkout redirect in src/app/billing/page.tsx)
 * rather than a fetch-based popup like the Nango Connect UI.
 *
 * Status contract assumed here (GET /api/integrations/<id>/status →
 * `{ configured, connected, account_name? }`) mirrors the shape /api/connections
 * already uses (global `configured` + per-provider `connected`) so it reads
 * consistently across both connection surfaces. TODO-verify: confirm this exact
 * shape against whatever the Jobber connect/status/disconnect routes actually
 * return once those land — this tile degrades safely either way (any fetch
 * failure or unexpected shape is treated as "not configured", never a crash).
 */
// The exact fixed strings the OAuth callback routes redirect back with in ?error=
// (see src/app/api/integrations/jobber/callback/route.ts). Anything else in the
// URL is attacker-supplied text and gets a generic message instead.
const KNOWN_OAUTH_CALLBACK_ERRORS = new Set([
  'Jobber sign-in was cancelled or denied',
  'Jobber sign-in could not be verified — please try again',
  'Could not complete the Jobber connection',
]);

function OAuthProviderTile({ p }: { p: ProviderDef }) {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/integrations/${p.id}/status`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'status check failed');
      setStatus({
        configured: json.configured !== false,
        connected: !!json.connected,
        account_name: json.account_name ?? null,
      });
    } catch {
      // Route not wired yet (or a real failure) — default closed rather than
      // claiming a connection we can't verify.
      setStatus({ configured: false, connected: false });
    } finally {
      setLoading(false);
    }
  }, [p.id]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // ?connected=<id> / ?error=... land here after the OAuth callback redirects
  // back to /connections.
  useEffect(() => {
    const connectedParam = searchParams?.get('connected');
    const errorParam = searchParams?.get('error');
    if (connectedParam === p.id) {
      setNotice(`${p.label} connected`);
      loadStatus();
    }
    // The OAuth callbacks only ever redirect back with one of these fixed
    // strings; anything else in ?error= is attacker-supplied URL text — show a
    // generic message instead of reflecting it into an authenticated page.
    if (errorParam) {
      setLocalError(
        KNOWN_OAUTH_CALLBACK_ERRORS.has(errorParam)
          ? errorParam
          : 'Connection failed — please try again.',
      );
    }
  }, [searchParams, p.id, p.label, loadStatus]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  function connect() {
    setBusy(true);
    window.location.href = p.connectPath || `/api/integrations/${p.id}/connect`;
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${p.label}?`)) return;
    setBusy(true);
    setLocalError(null);
    try {
      const res = await fetch(`/api/integrations/${p.id}/disconnect`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Disconnect failed');
      setNotice(`${p.label} disconnected`);
      await loadStatus();
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;

  return (
    <div className="panel">
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 shrink-0 rounded-lg bg-[var(--surface-2)] border border-border flex items-center justify-center text-foreground">
                <BrandLogo provider={p.id} size={16} />
              </div>
              <span className="font-semibold text-sm">{p.label}</span>
              <span className={`badge ${loading ? 'badge-neutral' : connected ? 'badge-success' : 'badge-neutral'}`}>
                {loading ? 'checking…' : connected ? <><CheckCircle2 size={10} /> connected</> : 'not connected'}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground capitalize">{p.category}</div>
            {p.scopesHint && <div className="text-[10px] text-muted-foreground">Scopes: {p.scopesHint}</div>}
            {connected && status?.account_name && (
              <div className="text-[10px] text-muted-foreground">Account: <span className="font-medium text-foreground">{status.account_name}</span></div>
            )}
          </div>
          <div className="flex gap-1">
            {!loading && configured && !connected && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={connect}>Connect {p.label}</button>
            )}
            {!loading && connected && (
              <button className="btn btn-destructive btn-sm" disabled={busy} onClick={disconnect} title="Disconnect"><X size={11} /></button>
            )}
          </div>
        </div>

        {!loading && !configured && (
          <div className="text-[11px] text-muted-foreground bg-[var(--surface-2)] rounded border border-border/60 p-2 flex items-center gap-1.5">
            <AlertCircle size={12} className="shrink-0" />
            Operator setup required — create an app in the Jobber Developer Center, then set JOBBER_CLIENT_ID / JOBBER_CLIENT_SECRET.
          </div>
        )}
        {localError && (
          <div className="text-[11px] text-destructive flex items-center gap-1.5">
            <AlertCircle size={12} className="shrink-0" /> {localError}
          </div>
        )}
        {notice && (
          <div className="text-[11px] text-emerald-500 flex items-center gap-1.5">
            <Check size={12} className="shrink-0" /> {notice}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * IntegrationsPanel — the API-key / credential-based integrations grid (AI,
 * messaging, email, analytics, etc.). Stores encrypted secrets via
 * /api/integrations-setup. Rendered as the second section of the Connections page,
 * alongside the one-tap social OAuth tiles (ConnectPanel).
 */
export function IntegrationsPanel() {
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/integrations-setup', { cache: 'no-store' });
    const json = await res.json();
    setProviders(json.providers ?? []);
    setIntegrations(json.integrations ?? []);
    setTenantId(json.tenant_id ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'all' ? providers : providers.filter((p) => p.category === filter);

  function startEdit(p: ProviderDef) {
    setEditing(p.id);
    setDraft({});
    setError(null);
  }

  async function save(p: ProviderDef) {
    setSaving(true);
    setError(null);
    try {
      const secret: Record<string, string> = {};
      const config: Record<string, string> = {};
      for (const f of p.fields) {
        const v = draft[f.name]?.trim();
        if (!v) continue;
        if (f.type === 'password') secret[f.name] = v;
        else config[f.name] = v;
      }
      const res = await fetch('/api/integrations-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: p.id, label: p.label, config, secret }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'save failed');
      else { setEditing(null); setDraft({}); await load(); }
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  async function clearProvider(provider: string) {
    if (!confirm(`Clear all stored credentials for ${provider}?`)) return;
    await fetch('/api/integrations-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, action: 'clear' }),
    });
    await load();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <KeyRound size={14} className="text-primary" /> API keys &amp; other services
        </div>
        <p className="text-xs text-muted-foreground">
          Connect tools your agents act through (AI, email, messaging, analytics&hellip;). Secrets are encrypted at rest
          (AES-256-GCM) and scoped to this workspace.
        </p>
      </div>

      <div className="flex gap-1 flex-wrap">
        {CATEGORIES.map((c) => (
          <button key={c.id} onClick={() => setFilter(c.id)} className={`tab ${filter === c.id ? 'active' : ''}`}>{c.label}</button>
        ))}
      </div>

      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filtered.map((p) => {
          if (p.kind === 'oauth') return <OAuthProviderTile key={p.id} p={p} />;
          const integration = integrations.find((i) => i.provider === p.id);
          const status = integration?.status ?? 'not_configured';
          const isEditing = editing === p.id;
          return (
            <div key={p.id} className={`panel ${p.comingSoon ? 'opacity-60' : ''}`} data-walkthrough={p.id === 'anthropic' ? 'connect-claude' : undefined}>
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 shrink-0 rounded-lg bg-[var(--surface-2)] border border-border flex items-center justify-center text-foreground">
                        <BrandLogo provider={p.id} size={16} />
                      </div>
                      <span className="font-semibold text-sm">{p.label}</span>
                      {p.comingSoon ? (
                        <span className="badge badge-neutral">Coming soon</span>
                      ) : (
                        <span className={`badge ${status === 'configured' ? 'badge-success' : status === 'error' || status === 'expired' ? 'badge-error' : 'badge-neutral'}`}>
                          {status === 'configured' ? <><CheckCircle2 size={10} /> connected</> : status === 'not_configured' ? 'not set up' : status}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground capitalize">{p.category}</div>
                    {!p.comingSoon && p.scopesHint && <div className="text-[10px] text-muted-foreground">Scopes: {p.scopesHint}</div>}
                  </div>
                  <div className="flex gap-1">
                    {!isEditing && !p.comingSoon && (
                      <button className="btn btn-ghost btn-sm" onClick={() => startEdit(p)}>
                        {integration?.has_secret ? 'Update' : 'Connect'}
                      </button>
                    )}
                    {integration?.has_secret && !isEditing && !p.comingSoon && (
                      <button className="btn btn-destructive btn-sm" onClick={() => clearProvider(p.id)}><X size={11} /></button>
                    )}
                  </div>
                </div>

                {isEditing && !p.comingSoon && (
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    {p.fields.map((f) => (
                      <div key={f.name} className="space-y-1">
                        <label className="text-[11px] font-medium">{f.label}{f.required && <span className="text-destructive"> *</span>}</label>
                        <input
                          type={f.type}
                          placeholder={f.placeholder || (integration?.has_secret ? '(leave blank to keep existing)' : '')}
                          value={draft[f.name] ?? ''}
                          onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
                          style={{ width: '100%' }}
                        />
                      </div>
                    ))}
                    {p.id === 'loopmessage' && tenantId && (
                      <div className="space-y-1 pt-1">
                        <label className="text-[11px] font-medium">Inbound webhook URL</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            readOnly
                            value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhook/loopmessage/${tenantId}`}
                            onFocus={(e) => e.currentTarget.select()}
                            className="text-[10px] font-mono"
                            style={{ width: '100%' }}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm shrink-0"
                            onClick={() => {
                              navigator.clipboard?.writeText(`${window.location.origin}/api/webhook/loopmessage/${tenantId}`)
                                .then(() => { setCopiedUrl(true); window.setTimeout(() => setCopiedUrl(false), 1500); })
                                .catch(() => {});
                            }}
                          >
                            {copiedUrl ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Point LoopMessage&rsquo;s webhook at this URL and set the <strong>Webhook Secret</strong> above to the same value
                          you configure in LoopMessage. Inbound iMessages then land in <em>this</em> workspace.
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => save(p)}>{saving ? 'Saving…' : 'Save'}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(null); setDraft({}); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default IntegrationsPanel;
