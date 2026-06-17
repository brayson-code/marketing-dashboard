'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Plus, Loader2, RefreshCw, Check } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { toast } from '@/components/ui/toast';

interface Skill { id: number; slug: string; name: string; category: string; description: string }
interface AgentOpt { id: string; name: string }

export default function SkillLibraryPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isHq, setIsHq] = useState(false);
  const [syncing, setSyncing] = useState(false);

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
        actions={isHq ? (
          <button className="btn btn-ghost btn-sm" onClick={sync} disabled={syncing}>
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync from GitHub
          </button>
        ) : undefined}
      />

      {loading ? (
        <div className="h-[40vh] grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : skills.length === 0 ? (
        <div className="panel p-6 text-sm text-muted-foreground">No skills in the library yet.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-stagger>
          {skills.map((s) => (
            <div key={s.slug} className="panel p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm">{s.name}</div>
                <span className="badge badge-neutral capitalize shrink-0">{s.category}</span>
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
