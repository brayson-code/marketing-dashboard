'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  PhoneCall, Download, Plug, Settings2, History, Copy, Check, Trash2,
  KeyRound, ExternalLink, AlertCircle,
} from 'lucide-react';
import { toast } from '@/components/ui/toast';

// SalesOps — re-host of the PIF AI Sales Co-Pilot Chrome extension as a multi-tenant
// Command Center feature. This page is the OWNER/MEMBER control surface:
//   1. Install   — download the packaged extension + load-unpacked steps
//   2. Connect   — mint a per-tenant SalesOps token and push it to the installed
//                  extension (with a copy-the-token fallback); list + revoke tokens
//   3. Configure — the prompt context (persona/playbook/company/pricing/…) + cadence
//   4. Review    — recent recorded calls + their CRM summaries
//
// The page itself is flag-gated (the nav item only shows when SALESOPS_ENABLED is true,
// and every /api/salesops-admin/* route returns 404 when the flag is off). Token gen and
// config writes go through SESSION-authed, owner|member-gated, tenant-scoped admin routes.

// Deterministic ID of the packaged extension (derived from the manifest "key"). The
// SalesOps page uses it to hand the freshly-minted token directly to the installed
// extension via chrome.runtime.sendMessage — no copy/paste needed when it works.
const EXTENSION_ID = 'maaajmcpggkooiocbfjdneccijejicaf';

// ── types ──────────────────────────────────────────────────────────────────────
interface TokenRow {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface SalesopsConfig {
  persona: string | null;
  playbook: string | null;
  company_name: string | null;
  product_name: string | null;
  pricing: string | null;
  differentiators: string | null;
  objection_keywords: string[];
  suggestion_interval_ms: number;
  summary_enabled: boolean;
  summary_fields: string[];
}

interface SalesCall {
  id: string;
  started_at: string;
  ended_at: string | null;
  platform: string | null;
  contact_name: string | null;
  contact_email: string | null;
  lead_id: string | null;
  summary: string | null;
  deal_temp: string | null;
  suggestions_count: number;
}

// chrome.runtime.sendMessage is only present inside an extension page; on a normal web
// page Chrome injects a (very small) chrome.runtime when the page is externally_connectable
// to an installed extension. We feature-detect it and fall back to copy/paste otherwise.
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage?: (
          extensionId: string,
          message: unknown,
          callback?: (response: unknown) => void,
        ) => void;
        lastError?: { message?: string };
      };
    };
  }
}

export default function SalesOpsPage() {
  return (
    <div className="space-y-6 animate-in">
      <div className="space-y-1">
        <h1 className="text-h1 flex items-center gap-2">
          <PhoneCall size={18} className="text-primary" /> SalesOps
        </h1>
        <p className="text-xs text-muted-foreground">
          Real-time AI sales coaching on your video calls. Install the browser extension, connect it to this
          workspace, tune the playbook, and review every call&rsquo;s summary here. Transcription and coaching use
          your own Deepgram and Anthropic keys from{' '}
          <Link href="/connections" className="text-primary hover:underline">Connections</Link>.
        </p>
      </div>

      <InstallSection />
      <div className="border-t border-border/50" />
      <ConnectSection />
      <div className="border-t border-border/50" />
      <ConfigureSection />
      <div className="border-t border-border/50" />
      <ReviewSection />
    </div>
  );
}

// ── 1. Install ───────────────────────────────────────────────────────────────────
function InstallSection() {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <Download size={14} className="text-primary" /> Install the extension
        </div>
        <p className="text-xs text-muted-foreground">
          Download the package, then load it as an unpacked extension in Chrome. The Web Store listing is coming soon.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-3">
        <a href="/salesops/pif-extension.zip" download className="btn btn-primary btn-sm inline-flex items-center gap-1.5 w-max">
          <Download size={13} /> Download extension (.zip)
        </a>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
          <li>Unzip the download to a folder you&rsquo;ll keep.</li>
          <li>
            Open <code className="font-mono text-[11px] px-1 rounded bg-surface-2">chrome://extensions</code> and turn on{' '}
            <span className="font-medium text-foreground">Developer mode</span> (top-right).
          </li>
          <li>Click <span className="font-medium text-foreground">Load unpacked</span> and select the unzipped folder.</li>
          <li>Pin the &ldquo;PIF AI Sales Co-Pilot&rdquo; icon, then come back here to <span className="font-medium text-foreground">Connect</span>.</li>
        </ol>
      </div>
    </section>
  );
}

// ── 2. Connect ───────────────────────────────────────────────────────────────────
function ConnectSection() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/salesops-admin/tokens', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setTokens(json.tokens ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const apiUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Try to hand the token straight to the installed extension. Returns true if the
  // extension acknowledged; false if it isn't reachable (→ show the copy/paste fallback).
  function pushToExtension(token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rt = window.chrome?.runtime;
      if (!rt?.sendMessage) return resolve(false);
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      try {
        rt.sendMessage(
          EXTENSION_ID,
          { type: 'salesops_connect', token, apiUrl },
          (response) => {
            // chrome.runtime.lastError is set when the extension isn't installed/reachable.
            if (rt.lastError) return done(false);
            done(!!(response && (response as { ok?: boolean }).ok));
          },
        );
      } catch {
        done(false);
      }
      // Safety net: if no callback fires (extension absent), don't hang the UI.
      setTimeout(() => done(false), 1200);
    });
  }

  async function mintAndConnect() {
    setMinting(true);
    setFreshToken(null);
    try {
      const res = await fetch('/api/salesops-admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: `Connected ${new Date().toLocaleDateString()}` }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || 'Could not create token'); return; }

      const token: string = json.token;
      setFreshToken(token); // always show it as the paste fallback
      const pushed = await pushToExtension(token);
      if (pushed) toast.success('Extension connected to this workspace');
      else toast.info('Token created — paste it into the extension to finish connecting');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMinting(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this token? Any extension using it will stop working.')) return;
    const res = await fetch('/api/salesops-admin/tokens', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) { toast.success('Token revoked'); await load(); }
    else toast.error('Could not revoke token');
  }

  function copyToken() {
    if (!freshToken) return;
    navigator.clipboard?.writeText(freshToken)
      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }

  const activeTokens = tokens.filter((t) => !t.revoked_at);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <Plug size={14} className="text-primary" /> Connect the extension
        </div>
        <p className="text-xs text-muted-foreground">
          Generate a connection token for this workspace. We&rsquo;ll hand it straight to the installed extension; if that
          can&rsquo;t reach it, copy the token and paste it into the extension&rsquo;s options.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-3">
        <button className="btn btn-primary btn-sm inline-flex items-center gap-1.5 w-max" disabled={minting} onClick={mintAndConnect}>
          <Plug size={13} /> {minting ? 'Connecting…' : 'Connect extension'}
        </button>

        {freshToken && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
              <AlertCircle size={12} /> Copy this token now — it won&rsquo;t be shown again
            </div>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={freshToken}
                onFocus={(e) => e.currentTarget.select()}
                className="text-[10px] font-mono"
                style={{ width: '100%' }}
              />
              <button type="button" className="btn btn-ghost btn-sm shrink-0 inline-flex items-center gap-1" onClick={copyToken}>
                {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Paste it into the extension&rsquo;s <span className="font-medium">Options → Connection</span> if the extension wasn&rsquo;t
              connected automatically. The API URL is{' '}
              <code className="font-mono">{apiUrl}</code>.
            </p>
          </div>
        )}

        {/* Active token list */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium flex items-center gap-1.5 text-muted-foreground">
            <KeyRound size={12} /> Connection tokens
          </div>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : activeTokens.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active tokens yet.</p>
          ) : (
            <div className="space-y-1">
              {activeTokens.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium truncate">{t.label || 'Untitled token'}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Added {fmtDate(t.created_at)}
                      {t.last_used_at ? ` · last used ${fmtDate(t.last_used_at)}` : ' · never used'}
                    </div>
                  </div>
                  <button className="btn btn-destructive btn-sm shrink-0" title="Revoke" onClick={() => revoke(t.id)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── 3. Configure ─────────────────────────────────────────────────────────────────
const SUMMARY_FIELD_OPTIONS = ['deal_temp', 'objections', 'pain_points', 'next_steps', 'action_items'];

function ConfigureSection() {
  const [saving, setSaving] = useState(false);

  // Local form state mirrors config; keyword/summary fields are edited as text.
  const [form, setForm] = useState({
    persona: '', playbook: '', company_name: '', product_name: '', pricing: '', differentiators: '',
    objection_keywords: '', suggestion_interval_ms: 15000, summary_enabled: false,
    summary_fields: [...SUMMARY_FIELD_OPTIONS],
  });

  const load = useCallback(async () => {
    const res = await fetch('/api/salesops-admin/config', { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    const c: SalesopsConfig = json.config;
    setForm({
      persona: c.persona ?? '',
      playbook: c.playbook ?? '',
      company_name: c.company_name ?? '',
      product_name: c.product_name ?? '',
      pricing: c.pricing ?? '',
      differentiators: c.differentiators ?? '',
      objection_keywords: (c.objection_keywords ?? []).join(', '),
      suggestion_interval_ms: c.suggestion_interval_ms ?? 15000,
      summary_enabled: !!c.summary_enabled,
      summary_fields: c.summary_fields ?? [...SUMMARY_FIELD_OPTIONS],
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/salesops-admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona: form.persona,
          playbook: form.playbook,
          company_name: form.company_name,
          product_name: form.product_name,
          pricing: form.pricing,
          differentiators: form.differentiators,
          objection_keywords: form.objection_keywords,
          suggestion_interval_ms: form.suggestion_interval_ms,
          summary_enabled: form.summary_enabled,
          summary_fields: form.summary_fields,
        }),
      });
      if (res.ok) { toast.success('Playbook saved'); await load(); }
      else { const j = await res.json(); toast.error(j.error || 'Save failed'); }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function toggleSummaryField(field: string) {
    setForm((f) => ({
      ...f,
      summary_fields: f.summary_fields.includes(field)
        ? f.summary_fields.filter((x) => x !== field)
        : [...f.summary_fields, field],
    }));
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <Settings2 size={14} className="text-primary" /> Playbook &amp; coaching
        </div>
        <p className="text-xs text-muted-foreground">
          Context the AI uses to coach live. This is shared by every connected rep in this workspace.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-3">
        <Field label="Company name">
          <input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} style={{ width: '100%' }} placeholder="Acme Inc." />
        </Field>
        <Field label="Product / service">
          <input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} style={{ width: '100%' }} placeholder="What you sell" />
        </Field>
        <Field label="Buyer persona" hint="Who you're typically selling to.">
          <textarea value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} style={{ width: '100%' }} rows={2} placeholder="e.g. VP of Sales at a 50–200 person B2B SaaS company" />
        </Field>
        <Field label="Sales playbook" hint="Methodology, tone, do's and don'ts.">
          <textarea value={form.playbook} onChange={(e) => setForm({ ...form, playbook: e.target.value })} style={{ width: '100%' }} rows={3} placeholder="e.g. Consultative. Lead with discovery. Never discount before value is established." />
        </Field>
        <Field label="Pricing">
          <input value={form.pricing} onChange={(e) => setForm({ ...form, pricing: e.target.value })} style={{ width: '100%' }} placeholder="e.g. $499/mo, annual discount available" />
        </Field>
        <Field label="Differentiators" hint="Why you win vs. alternatives.">
          <textarea value={form.differentiators} onChange={(e) => setForm({ ...form, differentiators: e.target.value })} style={{ width: '100%' }} rows={2} placeholder="e.g. Fastest setup, native CRM sync, white-glove onboarding" />
        </Field>
        <Field label="Objection keywords" hint="Comma-separated. Trigger an instant suggestion when heard.">
          <input value={form.objection_keywords} onChange={(e) => setForm({ ...form, objection_keywords: e.target.value })} style={{ width: '100%' }} placeholder="expensive, competitor, not sure, think about it" />
        </Field>

        <Field label="Suggestion interval" hint="How often coaching refreshes during a call.">
          <select
            value={form.suggestion_interval_ms}
            onChange={(e) => setForm({ ...form, suggestion_interval_ms: Number(e.target.value) })}
            style={{ width: '100%' }}
          >
            <option value={10000}>Every 10 seconds</option>
            <option value={15000}>Every 15 seconds</option>
            <option value={30000}>Every 30 seconds</option>
            <option value={60000}>Every 60 seconds</option>
          </select>
        </Field>

        <div className="space-y-2 pt-1 border-t border-border/40">
          <label className="flex items-center gap-2 text-[11px] font-medium cursor-pointer">
            <input type="checkbox" checked={form.summary_enabled} onChange={(e) => setForm({ ...form, summary_enabled: e.target.checked })} />
            Generate a CRM summary when the call ends
          </label>
          {form.summary_enabled && (
            <div className="pl-5 flex flex-wrap gap-2">
              {SUMMARY_FIELD_OPTIONS.map((f) => (
                <label key={f} className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                  <input type="checkbox" checked={form.summary_fields.includes(f)} onChange={() => toggleSummaryField(f)} />
                  {f.replace(/_/g, ' ')}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="pt-1">
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save playbook'}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium">{label}</label>
      {hint && <p className="text-[10px] text-muted-foreground -mt-0.5">{hint}</p>}
      {children}
    </div>
  );
}

// ── 4. Review ────────────────────────────────────────────────────────────────────
function ReviewSection() {
  const [calls, setCalls] = useState<SalesCall[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/salesops-admin/calls', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { calls: [] }))
      .then((j) => setCalls(j.calls ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <History size={14} className="text-primary" /> Recent calls
        </div>
        <p className="text-xs text-muted-foreground">
          Every call the extension recorded, with its AI summary. Matched contacts link to your CRM.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : calls.length === 0 ? (
        <div className="rounded-xl border border-border/50 p-6 text-center">
          <p className="text-xs text-muted-foreground">No calls yet. Start listening on a call and they&rsquo;ll appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {c.deal_temp && <DealTempPill temp={c.deal_temp} />}
                <span className="text-[11px] font-medium">
                  {c.contact_name || c.contact_email || 'Unknown contact'}
                </span>
                {c.platform && (
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-surface-2">
                    {c.platform}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">{fmtDate(c.started_at)}</span>
                {c.lead_id && (
                  <Link href="/crm" className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5">
                    CRM <ExternalLink size={9} />
                  </Link>
                )}
              </div>
              {c.summary && (
                <p className="text-[11px] text-muted-foreground whitespace-pre-wrap line-clamp-6">{c.summary}</p>
              )}
              <div className="text-[10px] text-muted-foreground">
                {c.suggestions_count} suggestion{c.suggestions_count === 1 ? '' : 's'} during the call
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DealTempPill({ temp }: { temp: string }) {
  const styles: Record<string, string> = {
    HOT: 'bg-destructive/15 text-destructive border-destructive/30',
    WARM: 'bg-warning/15 text-warning border-warning/30',
    COLD: 'bg-info/15 text-info border-info/30',
  };
  const cls = styles[temp.toUpperCase()] || 'bg-surface-2 text-muted-foreground border-border';
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${cls}`}>
      {temp}
    </span>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────────
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
