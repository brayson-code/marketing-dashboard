'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plug, AlertCircle, X, Plus, ShieldAlert } from 'lucide-react';

interface McpServer {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  has_auth: boolean;
  created_at: number;
}

/**
 * McpPanel — the MCP servers section of the Connections page. Each connected
 * server is a card with an enable/disable toggle + remove. When ENABLED, the
 * tenant's agents can call that server's tools (Anthropic discovers + runs them
 * server-side via the Messages API MCP connector), so a write-capable server
 * acts for real. Servers are added disabled and stay dormant until toggled on.
 */
export function McpPanel() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authToken, setAuthToken] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/mcp-servers', { cache: 'no-store' });
    const json = await res.json();
    setServers(json.servers ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/mcp-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), auth_token: authToken.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'failed to add'); return; }
      setName(''); setUrl(''); setAuthToken(''); setAdding(false);
      await load();
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  async function toggle(s: McpServer) {
    // Optimistic flip; reload reconciles with the server.
    setServers((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)));
    await fetch('/api/mcp-servers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, enabled: !s.enabled }),
    });
    await load();
  }

  async function remove(s: McpServer) {
    if (!confirm(`Remove MCP server "${s.name}"? Your agents will stop being able to use its tools.`)) return;
    await fetch(`/api/mcp-servers?id=${s.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <Plug size={14} className="text-primary" /> MCP servers
        </div>
        <p className="text-xs text-muted-foreground">
          Connect remote MCP servers so your agents can call their tools. When a server is <strong>enabled</strong>,
          Claude discovers and runs its tools for you mid-task &mdash; a write-capable server (one that can send,
          post, or change things) <strong>acts for real</strong>. New servers start disabled until you turn them on.
        </p>
      </div>

      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {servers.map((s) => (
          <div key={s.id} className="panel">
            <div className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 shrink-0 rounded-lg bg-[var(--surface-2)] border border-border flex items-center justify-center text-foreground">
                      <Plug size={16} />
                    </div>
                    <span className="font-semibold text-sm truncate">{s.name}</span>
                    <span className={`badge ${s.enabled ? 'badge-success' : 'badge-neutral'}`}>
                      {s.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate">{s.url}</div>
                  {s.has_auth && <div className="text-[10px] text-muted-foreground">Authenticated (token stored encrypted)</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={s.enabled}
                    aria-label={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`}
                    onClick={() => toggle(s)}
                    className="relative h-5 w-9 rounded-full border border-border transition-colors duration-[var(--t-press)] ease-[var(--ease-out)] active:scale-95"
                    style={{ background: s.enabled ? 'var(--primary)' : 'var(--surface-2)' }}
                  >
                    <span
                      className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-[left] duration-[var(--t-press)] ease-[var(--ease-out)]"
                      style={{ left: s.enabled ? '1.125rem' : '0.125rem' }}
                    />
                  </button>
                  <button className="btn btn-destructive btn-sm" onClick={() => remove(s)} aria-label={`Remove ${s.name}`}><X size={11} /></button>
                </div>
              </div>
              {s.enabled && (
                <div className="text-[10px] text-amber-500 flex items-start gap-1.5 pt-1 border-t border-border/40">
                  <ShieldAlert size={12} className="shrink-0 mt-px" />
                  <span>Your agents can call this server&rsquo;s tools. If it can perform writes, those actions are real.</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {servers.length === 0 && !adding && (
          <div className="panel p-4 text-xs text-muted-foreground lg:col-span-2">
            No MCP servers connected yet. Add one to give your agents extra tools.
          </div>
        )}
      </div>

      {adding ? (
        <div className="panel p-4 space-y-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium">Name<span className="text-destructive"> *</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sentry" style={{ width: '100%' }} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium">Server URL<span className="text-destructive"> *</span></label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/sse" style={{ width: '100%' }} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium">Authorization token <span className="text-muted-foreground">(optional)</span></label>
            <input type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="Bearer token, if the server requires one" style={{ width: '100%' }} />
            <p className="text-[10px] text-muted-foreground">Stored encrypted at rest. Leave blank for unauthenticated servers.</p>
          </div>
          <div className="flex gap-2 pt-1">
            <button className="btn btn-primary btn-sm" disabled={saving || !name.trim() || !url.trim()} onClick={add}>{saving ? 'Adding…' : 'Add server'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setName(''); setUrl(''); setAuthToken(''); setError(null); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add MCP server
        </button>
      )}
    </div>
  );
}

export default McpPanel;
