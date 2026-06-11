'use client';

import { useEffect, useState } from 'react';
import { Mail, Plus, Loader2, Copy, Check, PenLine, Send, CheckCircle2 } from 'lucide-react';

interface TenantInbox { account_id: string; address: string; agent_id: string | null; created_at: number }

// "Spawn email agent" — provisions a real inbox under the tenant's own AgentMail
// account (BYO key). Once an inbox exists, outreach-sender can send from it and
// replies flow into Engagement → Email for triage. Shows karma (the anti-spam
// currency) so the operator knows their send budget.
export function EmailAgentPanel() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [inboxes, setInboxes] = useState<TenantInbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [name, setName] = useState('');
  // Compose state — which inbox's form is open + the draft fields.
  const [composeFor, setComposeFor] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch('/api/integrations/agentmail/inbox', { cache: 'no-store' });
      const j = await r.json();
      setConnected(!!j.connected);
      setInboxes(Array.isArray(j.inboxes) ? j.inboxes : []);
      setError(j.error ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const spawn = async () => {
    setSpawning(true);
    setError(null);
    try {
      // Sanitize the local part — AgentMail usernames are lowercase alnum/.-_.
      const username = name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const r = await fetch('/api/integrations/agentmail/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(username ? { username } : {}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Spawn failed');
      setName('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSpawning(false);
    }
  };

  const copy = (addr: string) => {
    navigator.clipboard?.writeText(addr);
    setCopied(addr);
    setTimeout(() => setCopied(null), 1500);
  };

  const send = async (inbox: TenantInbox) => {
    setSending(true);
    setError(null);
    setSentMsg(null);
    try {
      const r = await fetch('/api/integrations/agentmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbox_id: inbox.account_id, to, subject, text: bodyText }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Send failed');
      setSentMsg(`Sent to ${to}`);
      setTo(''); setSubject(''); setBodyText('');
      setTimeout(() => { setComposeFor(null); setSentMsg(null); }, 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const inputCls = 'text-xs px-2 py-1.5 rounded-md border border-border bg-[var(--surface-1)] outline-none w-full';

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Mail size={14} className="text-[#6366f1]" />
        <h3 className="section-title">Email agents</h3>
        {connected && (
          <div className="ml-auto flex items-center gap-1.5">
            <div className="flex items-center rounded-md border border-border bg-[var(--surface-1)] overflow-hidden">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !spawning) spawn(); }}
                placeholder="name"
                className="text-xs px-2 py-1 w-24 bg-transparent outline-none"
                aria-label="Inbox name (optional)"
              />
              <span className="text-[10px] text-muted-foreground pr-2 select-none">@agentmail.to</span>
            </div>
            <button onClick={spawn} disabled={spawning} className="btn btn-primary btn-sm inline-flex items-center gap-1">
              {spawning ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Spawn
            </button>
          </div>
        )}
      </div>
      <div className="panel-body space-y-2.5">
        {loading ? (
          <div className="py-6 flex items-center justify-center gap-2 text-small"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : connected === false ? (
          <div className="py-6 text-center text-small">
            Connect AgentMail to spawn email agents — paste your API key in <a href="/connections" className="underline">Connections</a> (Email → AgentMail).
          </div>
        ) : (
          <>
            {error && <div className="text-small text-destructive">{error}</div>}
            {inboxes.length === 0 ? (
              <div className="py-6 text-center text-small">
                No email agents yet. Click <em>Spawn email agent</em> to provision an inbox under your AgentMail account.
              </div>
            ) : (
              inboxes.map((ib) => (
                <div key={ib.account_id} className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)]">
                  <div className="flex items-center gap-2.5 p-2.5">
                    <span className="w-7 h-7 rounded-full grid place-items-center shrink-0" style={{ background: 'color-mix(in srgb, #6366f1 16%, transparent)', color: '#6366f1' }}>
                      <Mail size={13} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-mono font-medium truncate">{ib.address}</div>
                      <div className="text-micro text-muted-foreground">live · replies show in Engagement → Email</div>
                    </div>
                    <button
                      onClick={() => { setComposeFor(composeFor === ib.account_id ? null : ib.account_id); setSentMsg(null); setError(null); }}
                      className="btn btn-ghost btn-sm shrink-0 inline-flex items-center gap-1"
                    >
                      <PenLine size={11} /> Compose
                    </button>
                    <button onClick={() => copy(ib.address)} className="btn btn-ghost btn-sm shrink-0" title="Copy address">
                      {copied === ib.address ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  </div>
                  {composeFor === ib.account_id && (
                    <div className="border-t border-border/40 p-2.5 space-y-2">
                      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="to — e.g. brayson@keyplayershq.com" className={inputCls} />
                      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="subject" className={inputCls} />
                      <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="message" rows={3} className={inputCls + ' resize-y'} />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => send(ib)}
                          disabled={sending || !to.trim() || !bodyText.trim()}
                          className="btn btn-primary btn-sm inline-flex items-center gap-1"
                        >
                          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send from {ib.address}
                        </button>
                        {sentMsg && <span className="text-[11px] text-[var(--primary)] inline-flex items-center gap-1"><CheckCircle2 size={12} /> {sentMsg}</span>}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            <p className="text-micro text-muted-foreground">
              Replies to these inboxes appear in <a href="/engagement" className="underline">Engagement → Email</a> for one-click drafted replies.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
