'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Plus, Loader2, RefreshCw, Check, X, Wand2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { toast } from '@/components/ui/toast';

interface Skill { id: number; slug: string; name: string; category: string; description: string; is_custom?: boolean }
interface AgentOpt { id: string; name: string }

export default function SkillLibraryPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isHq, setIsHq] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // "Add your own skill" form
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'custom', description: '', bodyText: '', bodyUrl: '' });
  const [savingNew, setSavingNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/skills', { cache: 'no-store' });
      const j = await r.json();
      setSkills(j.skills ?? []);
      setAgents(j.agents ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((j) => setIsHq(!!j?.is_hq)).catch(() => {});
  }, []);

  async function install(skill: Skill) {
    const agentId = picked[skill.slug] || agents[0]?.id;
    if (!agentId) { toast.error('No agent to install into.'); return; }
    setInstalling(skill.slug);
    try {
      const r = await fetch('/api/skills', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', slug: skill.slug, agentId }),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || 'Install failed'); return; }
      toast.success(`Added "${skill.name}" to ${agents.find((a) => a.id === agentId)?.name ?? agentId}`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setInstalling(null); }
  }

  async function addOwn() {
    if (!form.name.trim() || (!form.bodyText.trim() && !form.bodyUrl.trim())) {
      toast.error('Give it a name and either paste the skill or an import URL.'); return;
    }
    setSavingNew(true);
    try {
      const r = await fetch('/api/skills', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', name: form.name, category: form.category, description: form.description, bodyText: form.bodyText, bodyUrl: form.bodyUrl }),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || 'Could not add skill'); return; }
      toast.success(`Added "${form.name}" to your library`);
      setForm({ name: '', category: 'custom', description: '', bodyText: '', bodyUrl: '' });
      setAdding(false);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSavingNew(false); }
  }

  async function deleteSkill(s: Skill) {
    if (!confirm(`Delete your skill "${s.name}"? (Agents that already have it keep it until you remove it there.)`)) return;
    try {
      const r = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete-skill', slug: s.slug }) });
      if (!r.ok) { const j = await r.json(); toast.error(j.error || 'Delete failed'); return; }
      await load();
    } catch (e) { toast.error((e as Error).message); }
  }

  async function sync() {
    setSyncing(true);
    try {
      const r = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || 'Sync failed'); return; }
      toast.success(`Synced ${j.synced} skills from ${j.repo}`);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSyncing(false); }
  }

  return (
    <div className="space-y-4 animate-in">
      <PageHeader
        icon={<Boxes size={18} />}
        title="Skill Library"
        subtitle="Reusable skills you can drop into any agent. Installing a skill teaches that agent the playbook — it's added to the agent's instructions in Agent Studio."
        actions={
          <div className="flex gap-1.5">
            <button className="btn btn-secondary btn-sm" onClick={() => setAdding((v) => !v)}>
              <Wand2 size={12} /> Add your own
            </button>
            {isHq && (
              <button className="btn btn-ghost btn-sm" onClick={sync} disabled={syncing}>
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync from GitHub
              </button>
            )}
          </div>
        }
      />

      {adding && (
        <div className="panel p-4 space-y-2.5 animate-in">
          <div className="font-semibold text-sm">Add your own skill</div>
          <p className="text-[11px] text-muted-foreground">Paste a skill you found (plain text or markdown), or import one from a raw URL. It joins your library and installs into agents like the rest.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input placeholder="Skill name (e.g. LinkedIn DM opener)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%' }} />
            <input placeholder="Category (e.g. outreach)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ width: '100%' }} />
          </div>
          <input placeholder="One-line description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ width: '100%' }} />
          <textarea placeholder="Paste the skill text here…" rows={5} value={form.bodyText} onChange={(e) => setForm({ ...form, bodyText: e.target.value })} className="w-full text-xs" />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">or import from URL:</span>
            <input placeholder="https://raw.githubusercontent.com/…/skill.md" value={form.bodyUrl} onChange={(e) => setForm({ ...form, bodyUrl: e.target.value })} className="flex-1 text-xs" />
          </div>
          <div className="flex gap-2 pt-1">
            <button className="btn btn-primary btn-sm" onClick={addOwn} disabled={savingNew}>{savingNew ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add to library</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-[40vh] grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : skills.length === 0 ? (
        <div className="panel p-6 text-sm text-muted-foreground">No skills in the library yet.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-stagger>
          {skills.map((s) => (
            <div key={s.slug} className="panel p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  {s.name}
                  {s.is_custom && <span className="badge badge-info">yours</span>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="badge badge-neutral capitalize">{s.category}</span>
                  {s.is_custom && (
                    <button className="btn btn-ghost btn-sm p-1" onClick={() => deleteSkill(s)} aria-label={`Delete ${s.name}`}><X size={12} /></button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.description}</p>
              <div className="flex items-center gap-2 pt-1">
                <select
                  className="text-xs flex-1 min-w-0"
                  value={picked[s.slug] ?? ''}
                  onChange={(e) => setPicked((p) => ({ ...p, [s.slug]: e.target.value }))}
                >
                  {agents.length === 0 && <option value="">No agents</option>}
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button
                  className="btn btn-primary btn-sm shrink-0"
                  onClick={() => install(s)}
                  disabled={installing === s.slug || agents.length === 0}
                >
                  {installing === s.slug ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add to agent
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Check size={11} /> Installed skills are merged into the agent&apos;s instructions and apply on its next run. Edit or remove them anytime in <a className="text-[var(--primary)] underline" href="/agents/workspace">Agent Studio</a>.
      </p>
    </div>
  );
}
