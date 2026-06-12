'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users, UserPlus, Copy, Check, ShieldAlert } from 'lucide-react';

interface Client {
  id: string;
  name: string;
  plan: string;
  onboarding_complete: boolean;
  created_at: string;
  owner_email: string | null;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<{ email: string; link: string | null; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/clients', { cache: 'no-store' });
    if (r.status === 403) { setForbidden(true); return; }
    const j = await r.json();
    setClients(j.clients ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addClient(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setInvite(null);
    try {
      const r = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'Failed to add client'); return; }
      setInvite({ email: j.email, link: j.inviteLink ?? null, emailed: !!j.emailed });
      setName(''); setEmail('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copyLink(link: string) {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* ignore */ });
  }

  if (forbidden) {
    return (
      <div className="space-y-6 animate-in max-w-2xl">
        <div className="panel p-6 flex items-start gap-3">
          <ShieldAlert size={18} className="text-[var(--warning,#f59e0b)] shrink-0 mt-0.5" />
          <div>
            <h1 className="text-h1">Clients</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Only the platform owner can add and manage client workspaces.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in max-w-3xl">
      <div className="space-y-1">
        <h1 className="text-h1 flex items-center gap-2"><Users size={18} className="text-primary" /> Clients</h1>
        <p className="text-xs text-muted-foreground">
          Invite a client into their own isolated workspace. They get their own AI team and data — separate from yours.
        </p>
      </div>

      {/* Add client */}
      <form onSubmit={addClient} className="panel p-4 space-y-3">
        <div className="section-title flex items-center gap-1.5"><UserPlus size={14} className="text-primary" /> Add a client</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="client-name" className="text-[11px] font-medium">Workspace name</label>
            <input id="client-name" name="client-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Co." autoComplete="organization" style={{ width: '100%' }} required />
          </div>
          <div className="space-y-1">
            <label htmlFor="client-email" className="text-[11px] font-medium">Client email</label>
            <input id="client-email" name="client-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="founder@acme.com" autoComplete="email" style={{ width: '100%' }} required />
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
          {busy ? 'Provisioning…' : 'Create workspace + invite'}
        </button>

        {invite && (
          <div className="panel p-3 mt-1" style={{ background: 'color-mix(in srgb, var(--success) 8%, transparent)', borderColor: 'color-mix(in srgb, var(--success) 25%, transparent)' }}>
            <p className="text-xs font-medium text-[var(--success)]">
              Workspace created for {invite.email}.{invite.emailed && ' Invite emailed ✓'}
            </p>
            {invite.link ? (
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={invite.link} style={{ width: '100%' }} className="text-[11px] font-mono" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" onClick={() => copyLink(invite.link!)} className="btn btn-ghost btn-sm shrink-0" aria-label="Copy invite link">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-1">Send them a magic link from Supabase, or they can sign in once email is wired.</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {invite.emailed
                ? 'They were emailed this one-time sign-in link — copy it here if you’d rather share it yourself.'
                : 'Email not configured — copy this one-time sign-in link and send it to your client yourself.'}
            </p>
          </div>
        )}
      </form>

      {/* Client list */}
      <div className="panel">
        <div className="panel-header"><div className="section-title">Your clients</div></div>
        <div className="panel-body">
          {clients === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : clients.length === 0 ? (
            <p className="text-xs text-muted-foreground">No clients yet. Add your first above.</p>
          ) : (
            <div className="space-y-1.5" data-stagger>
              {clients.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2" style={{ background: 'color-mix(in srgb, var(--surface-2) 55%, transparent)' }}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{c.owner_email ?? '—'}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="badge badge-neutral capitalize">{c.plan}</span>
                    <span className={`badge ${c.onboarding_complete ? 'badge-success' : 'badge-neutral'}`}>
                      {c.onboarding_complete ? 'onboarded' : 'pending'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
