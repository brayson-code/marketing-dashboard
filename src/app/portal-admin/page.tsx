'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Settings2, Loader2, Save, Check, Trash2, Megaphone, ShieldAlert, Send,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';

// HQ-only editor behind /portal. Two jobs: fill in a workspace's assistant details, and
// publish announcements/events that every workspace sees.
//
// Separate page rather than an edit mode on /portal because the audiences are different
// — a client reads their own placement, an operator works across all of them.

interface Workspace { id: string; name: string; agents: number }
interface Profile {
  ea_name: string | null; ea_role: string | null; ea_started_on: string | null;
  ea_timezone: string | null; ea_hours_start: string; ea_hours_end: string;
  ea_days: string[]; holiday_region: string;
  success_contact_name: string | null; success_contact_email: string | null;
  plan_name: string | null; notes: string | null;
}
interface Announcement {
  id: string; kind: string; audience: string; title: string; body: string;
  starts_at: string | null; location: string | null; link: string | null; pinned: boolean;
}

const BLANK: Profile = {
  ea_name: '', ea_role: '', ea_started_on: '', ea_timezone: '',
  ea_hours_start: '09:00', ea_hours_end: '17:00',
  ea_days: ['mon', 'tue', 'wed', 'thu', 'fri'], holiday_region: 'CA',
  success_contact_name: '', success_contact_email: '', plan_name: '', notes: '',
};

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export default function PortalAdminPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [tenant, setTenant] = useState('');
  const [profile, setProfile] = useState<Profile>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [draft, setDraft] = useState({
    kind: 'announcement', audience: 'client', title: '', body: '',
    starts_at: '', location: '', link: '', pinned: false,
  });

  const load = useCallback(async (t: string) => {
    const res = await fetch(`/api/portal/admin${t ? `?tenant=${encodeURIComponent(t)}` : ''}`);
    if (res.status === 403) { setForbidden(true); setLoading(false); return; }
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();
    setWorkspaces(data.workspaces ?? []);
    setAnnouncements(data.announcements ?? []);
    if (t) setProfile({ ...BLANK, ...(data.profile ?? {}) });
    setLoading(false);
  }, []);

  useEffect(() => { load(''); }, [load]);
  useEffect(() => { if (tenant) load(tenant); }, [tenant, load]);

  const saveProfile = async () => {
    if (!tenant) return;
    setSaving(true);
    try {
      const res = await fetch('/api/portal/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'profile', tenant, profile }),
      });
      if (res.ok) { setSavedAt(true); setTimeout(() => setSavedAt(false), 2000); }
    } finally { setSaving(false); }
  };

  const publish = async () => {
    if (!draft.title.trim()) return;
    const res = await fetch('/api/portal/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'announce', announcement: draft }),
    });
    if (res.ok) {
      setDraft({ kind: 'announcement', audience: 'client', title: '', body: '', starts_at: '', location: '', link: '', pinned: false });
      load(tenant);
    }
  };

  const remove = async (id: string) => {
    await fetch('/api/portal/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    load(tenant);
  };

  if (forbidden) {
    return (
      <div className="space-y-4">
        <PageHeader icon={<ShieldAlert size={20} />} title="Portal Admin" />
        <div className="panel p-6 text-sm text-muted-foreground">
          This is an operator surface and isn&apos;t available in this workspace.
        </div>
      </div>
    );
  }

  const field = (label: string, key: keyof Profile, type = 'text', placeholder = '') => (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type={type}
        value={(profile[key] as string) ?? ''}
        placeholder={placeholder}
        onChange={(e) => setProfile(p => ({ ...p, [key]: e.target.value }))}
        className="w-full mt-0.5 text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Settings2 size={20} />}
        title="Portal Admin"
        subtitle="Fill in a client's assistant details, and publish what every workspace sees."
      />

      <Explainer
        id="portal-admin"
        title="What this is"
        what="The operator side of Your KeyPlayers. Assistant details are per client; announcements and events publish to every workspace at once."
        when="During onboarding for the assistant details, and any time there's something clients should know about."
        example="Set the start date — probation and accrued leave are calculated from it."
      />

      {loading ? (
        <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="panel p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold">Assistant details</p>
              <select
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                className="text-xs bg-[var(--surface-2)] border border-border rounded-lg px-2 py-1.5"
              >
                <option value="">Pick a workspace…</option>
                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {tenant && (
                <button
                  onClick={saveProfile} disabled={saving}
                  className="ml-auto text-xs font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white"
                  style={{ background: 'var(--primary)' }}
                >
                  {saving ? <Loader2 size={12} className="animate-spin" />
                    : savedAt ? <Check size={12} /> : <Save size={12} />}
                  {savedAt ? 'Saved' : 'Save'}
                </button>
              )}
            </div>

            {tenant ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {field("Assistant's name", 'ea_name', 'text', 'e.g. Maria Santos')}
                {field('What they own', 'ea_role', 'text', 'e.g. Inbox, calendar and client follow-up')}
                {field('Start date WITH THIS CLIENT', 'ea_started_on', 'date')}
                {field('Timezone', 'ea_timezone', 'text', 'e.g. America/Toronto')}
                {field('Hours start', 'ea_hours_start', 'time')}
                {field('Hours end', 'ea_hours_end', 'time')}
                {field('Client success contact', 'success_contact_name', 'text', 'e.g. Pow')}
                {field('Their email', 'success_contact_email', 'email')}
                {field('Plan', 'plan_name', 'text', 'e.g. KeyPlayers Elite')}

                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Holiday calendar</span>
                  <select
                    value={profile.holiday_region}
                    onChange={(e) => setProfile(p => ({ ...p, holiday_region: e.target.value }))}
                    className="w-full mt-0.5 text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
                  >
                    <option value="CA">Canadian statutory</option>
                    <option value="US">US federal</option>
                  </select>
                </label>

                <div className="sm:col-span-2">
                  <span className="text-[11px] text-muted-foreground">Working days</span>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    {DAYS.map(d => {
                      const on = profile.ea_days.includes(d);
                      return (
                        <button
                          key={d}
                          onClick={() => setProfile(p => ({
                            ...p,
                            ea_days: on ? p.ea_days.filter(x => x !== d) : [...p.ea_days, d],
                          }))}
                          className="text-xs px-2.5 py-1 rounded-lg border"
                          style={on
                            ? { background: 'var(--primary)', color: 'white', borderColor: 'var(--primary)' }
                            : { borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Pick a workspace to fill in who supports them.
              </p>
            )}
          </div>

          {/* Publish */}
          <div className="panel p-4 space-y-3">
            <p className="text-sm font-semibold">Publish to every workspace</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <select
                value={draft.kind}
                onChange={(e) => setDraft(d => ({ ...d, kind: e.target.value }))}
                className="text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
              >
                <option value="announcement">Announcement</option>
                <option value="event">Event</option>
                <option value="training">Training</option>
              </select>
              <select
                value={draft.audience}
                onChange={(e) => setDraft(d => ({ ...d, audience: e.target.value }))}
                className="text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
              >
                <option value="client">Clients</option>
                <option value="va">Assistants</option>
                <option value="all">Everyone</option>
              </select>
              <input
                type="datetime-local" value={draft.starts_at}
                onChange={(e) => setDraft(d => ({ ...d, starts_at: e.target.value }))}
                className="text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox" checked={draft.pinned}
                  onChange={(e) => setDraft(d => ({ ...d, pinned: e.target.checked }))}
                />
                Pin to top
              </label>
            </div>
            <input
              placeholder="Title"
              value={draft.title}
              onChange={(e) => setDraft(d => ({ ...d, title: e.target.value }))}
              className="w-full text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
            />
            <textarea
              placeholder="What clients need to know"
              rows={2}
              value={draft.body}
              onChange={(e) => setDraft(d => ({ ...d, body: e.target.value }))}
              className="w-full text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                placeholder="Location (optional)" value={draft.location}
                onChange={(e) => setDraft(d => ({ ...d, location: e.target.value }))}
                className="text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
              />
              <input
                placeholder="Link (optional)" value={draft.link}
                onChange={(e) => setDraft(d => ({ ...d, link: e.target.value }))}
                className="text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
              />
            </div>
            <button
              onClick={publish} disabled={!draft.title.trim()}
              className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
              style={{ background: 'var(--primary)' }}
            >
              <Send size={12} /> Publish
            </button>
          </div>

          {announcements.length > 0 && (
            <div className="panel p-4 space-y-1">
              <p className="text-sm font-semibold mb-1">Published</p>
              {announcements.map(a => (
                <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
                  <Megaphone size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.kind} · {a.audience}{a.pinned && ' · pinned'}
                      {a.starts_at && ` · ${new Date(a.starts_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(a.id)}
                    className="text-muted-foreground hover:text-[var(--destructive)] shrink-0"
                    aria-label={`Delete ${a.title}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
