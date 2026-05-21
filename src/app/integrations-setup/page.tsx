'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plug, CheckCircle2, AlertCircle, X } from 'lucide-react';

type Category = 'ai' | 'messaging' | 'email' | 'calendar' | 'social' | 'analytics' | 'crm' | 'storage' | 'other';

interface ProviderDef {
  id: string;
  label: string;
  category: Category;
  fields: Array<{ name: string; label: string; type: 'text' | 'password' | 'url'; required?: boolean; placeholder?: string }>;
  scopesHint?: string;
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
  { id: 'storage', label: 'Other tools' },
];

export default function IntegrationsSetupPage() {
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/integrations-setup', { cache: 'no-store' });
    const json = await res.json();
    setProviders(json.providers ?? []);
    setIntegrations(json.integrations ?? []);
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
    <div className="space-y-4 animate-in">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Integrations Setup</h1>
        <p className="text-xs text-muted-foreground">
          Connect external services so KeyPlayer + sub-agents can act on your behalf.
          Secrets are encrypted at rest (AES-256-GCM); the encryption key is derived from <code>KEYPLAYERS_SECRETS_KEY</code> in your env.
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
          const integration = integrations.find((i) => i.provider === p.id);
          const status = integration?.status ?? 'not_configured';
          const isEditing = editing === p.id;
          return (
            <div key={p.id} className="panel">
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Plug size={13} className="text-muted-foreground" />
                      <span className="font-semibold text-sm">{p.label}</span>
                      <span className={`badge ${status === 'configured' ? 'badge-success' : status === 'error' || status === 'expired' ? 'badge-error' : 'badge-neutral'}`}>
                        {status === 'configured' ? <><CheckCircle2 size={10} /> connected</> : status === 'not_configured' ? 'not set up' : status}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground capitalize">{p.category}</div>
                    {p.scopesHint && <div className="text-[10px] text-muted-foreground">Scopes: {p.scopesHint}</div>}
                  </div>
                  <div className="flex gap-1">
                    {!isEditing && (
                      <button className="btn btn-ghost btn-sm" onClick={() => startEdit(p)}>
                        {integration?.has_secret ? 'Update' : 'Connect'}
                      </button>
                    )}
                    {integration?.has_secret && !isEditing && (
                      <button className="btn btn-destructive btn-sm" onClick={() => clearProvider(p.id)}><X size={11} /></button>
                    )}
                  </div>
                </div>

                {isEditing && (
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

      <div className="panel p-3 text-[11px] text-muted-foreground">
        <strong>Security note:</strong> Secrets are encrypted in SQLite with a key derived from your environment.
        For production deploys, set <code>KEYPLAYERS_SECRETS_KEY</code> to a long random value and store it in a real secrets manager (Vercel env, 1Password, etc.).
        Right now this dashboard runs single-tenant; per-client isolation is a future enhancement.
      </div>
    </div>
  );
}
