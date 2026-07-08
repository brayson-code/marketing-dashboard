'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plug, RefreshCw, Link2, Unlink, AlertCircle, Check, Loader2 } from 'lucide-react';
import { BrandLogo } from '@/components/connections/brand-logo';

interface ProviderStatus {
  key: string;
  label: string;
  connected: boolean;
  connected_at: string | null;
  available?: boolean; // OAuth app wired in Nango — false = "not set up yet"
}

// We dynamically import @nangohq/frontend so it never loads on the server or when
// unconfigured. The event passed to onEvent is the SDK's ConnectUIEvent union; we
// act on the discriminated 'connect' / 'close' / 'error' members and read it loosely
// to stay resilient to minor SDK shape changes.

/**
 * ConnectPanel — social-OAuth connection manager for the current workspace.
 * Fetches /api/connections on mount, renders one glass tile per provider, and drives
 * the Nango Connect UI on demand. Safe when Nango is unconfigured: it shows an inline
 * note and disables the connect buttons rather than crashing.
 */
export default function ConnectPanel() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // provider key currently connecting/disconnecting

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/connections', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load connections');
      setProviders(json.providers ?? []);
      setConfigured(json.configured !== false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const connect = useCallback(
    async (provider: ProviderStatus) => {
      setBusy(provider.key);
      setError(null);
      try {
        const res = await fetch('/api/connections/session', { method: 'POST' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to start connection');

        if (!json.configured || !json.token) {
          setConfigured(false);
          setBusy(null);
          return;
        }

        // Load the browser SDK lazily — only when actually connecting.
        const mod = await import('@nangohq/frontend');
        const NangoFrontend = mod.default;
        const nango = new NangoFrontend({ connectSessionToken: json.token });

        const connectUI = nango.openConnectUI({
          sessionToken: json.token,
          onEvent: async (event) => {
            if (event.type === 'connect') {
              const providerConfigKey = event.payload?.providerConfigKey;
              const connectionId = event.payload?.connectionId;
              if (providerConfigKey && connectionId) {
                try {
                  await fetch('/api/connections', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // Map the upstream integration back to whichever provider tile we
                    // launched from; the Connect UI may surface only the config key.
                    body: JSON.stringify({ provider: provider.key, connectionId, providerConfigKey }),
                  });
                  setNotice(`${provider.label} connected`);
                } catch {
                  setError('Connected, but failed to save. Try refreshing.');
                }
              }
              connectUI.close();
              setBusy(null);
              await load();
            } else if (event.type === 'close') {
              setBusy(null);
            } else if (event.type === 'error') {
              const errorType = event.payload?.errorType;
              const errorMessage = event.payload?.errorMessage;
              setError(
                [errorType, errorMessage].filter(Boolean).join(': ') || 'Connection failed. Please try again.',
              );
              setBusy(null);
            }
          },
        });
      } catch (e) {
        setError((e as Error).message);
        setBusy(null);
      }
    },
    [load],
  );

  const removeConnection = useCallback(
    async (provider: ProviderStatus) => {
      setBusy(provider.key);
      setError(null);
      try {
        const res = await fetch(`/api/connections?provider=${encodeURIComponent(provider.key)}`, {
          method: 'DELETE',
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to disconnect');
        setNotice(`${provider.label} disconnected`);
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="section-title flex items-center gap-1.5">
          <Plug size={14} className="text-primary" /> Social connections
        </div>
        <button onClick={load} className="btn btn-ghost btn-sm" disabled={loading}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {!configured && (
        <div className="text-xs text-muted-foreground bg-[var(--surface-2)] rounded border border-border/60 p-2.5 flex items-center gap-1.5">
          <AlertCircle size={12} /> OAuth apps not linked yet — connections activate once set up.
        </div>
      )}
      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}
      {notice && (
        <div className="panel p-3 text-xs text-emerald-500 flex items-center gap-1.5">
          <Check size={12} /> {notice}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {providers.map((p) => {
          const isBusy = busy === p.key;
          const ready = configured && p.available !== false;
          const soon = !p.connected && !ready;
          return (
            <div key={p.key} className={`panel p-3 flex items-center justify-between gap-3 ${soon ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 shrink-0 rounded-lg bg-[var(--surface-2)] border border-border flex items-center justify-center text-foreground">
                  <BrandLogo provider={p.key} size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.label}</div>
                  <span className={`badge ${p.connected ? 'badge-success' : 'badge-neutral'}`}>
                    {p.connected ? 'connected' : ready ? 'not connected' : 'Coming soon'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!soon && (
                <button
                  onClick={() => connect(p)}
                  disabled={isBusy || !ready}
                  className="btn btn-primary btn-sm"
                >
                  {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                  {p.connected ? 'Reconnect' : 'Connect'}
                </button>
                )}
                {p.connected && (
                  <button
                    onClick={() => removeConnection(p)}
                    disabled={isBusy}
                    className="btn btn-ghost btn-sm"
                    title="Disconnect"
                  >
                    <Unlink size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ConnectPanel };
