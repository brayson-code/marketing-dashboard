'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Crown, RefreshCw, Save, Trash2, Plus, Wand2, FlaskConical, Play, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { AgentPlaybookWizard } from '@/components/agents/agent-playbook-wizard';
import { CreateAgentModal } from '@/components/agents/create-agent-modal';
import { Explainer } from '@/components/ui/explainer';

// Known Claude models (latest family). The select keeps any legacy/custom value
// already on a def so it isn't silently dropped.
const MODELS: { id: string; label: string }[] = [
  { id: 'claude-fable-5', label: 'Fable 5 — most powerful, agentic (premium)' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8 — most capable' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 — balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fast & cheap' },
];

function ModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = MODELS.some((m) => m.id === value);
  return (
    <select className="input text-sm font-mono" value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value && <option value={value}>{value} (custom)</option>}
      {MODELS.map((m) => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
    </select>
  );
}

type AgentRole =
  | 'research'
  | 'content'
  | 'outreach'
  | 'scheduler'
  | 'creative'
  | 'general'
  | 'orchestrator';

const ROLES: AgentRole[] = [
  'research',
  'content',
  'outreach',
  'scheduler',
  'creative',
  'general',
  'orchestrator',
];

type AgentSource = 'builtin' | 'custom';

interface AgentSummary {
  id: string;
  name: string;
  role: string;
  model: string;
  max_tokens: number;
  rate_per_hour: number;
  description: string;
  spawnable: boolean;
  enabled: boolean;
  source: AgentSource;
  updated_at: string;
}

interface AgentDef extends AgentSummary {
  soul: string;
  agent_md: string;
  skills: string;
  created_at: string;
}

type Editable = {
  name: string;
  role: AgentRole;
  model: string;
  max_tokens: number;
  rate_per_hour: number;
  description: string;
  soul: string;
  agent_md: string;
  skills: string;
  spawnable: boolean;
  enabled: boolean;
};

function toEditable(a: AgentDef): Editable {
  return {
    name: a.name ?? '',
    role: (ROLES.includes(a.role as AgentRole) ? a.role : 'general') as AgentRole,
    model: a.model ?? '',
    max_tokens: Number(a.max_tokens ?? 0),
    rate_per_hour: Number(a.rate_per_hour ?? 0),
    description: a.description ?? '',
    soul: a.soul ?? '',
    agent_md: a.agent_md ?? '',
    skills: a.skills ?? '',
    spawnable: Boolean(a.spawnable),
    enabled: Boolean(a.enabled),
  };
}

export default function AgentStudioPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [def, setDef] = useState<AgentDef | null>(null);
  const [draft, setDraft] = useState<Editable | null>(null);
  const [loadingDef, setLoadingDef] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  // Test-run sandbox: a cheap, single-turn dry run of the CURRENT draft against a
  // sample input. Never saves and never counts as a real task — it's just here so
  // the owner can iterate on the definition before hitting Save.
  const [testOpen, setTestOpen] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testing, setTesting] = useState(false);

  // Reset the sandbox whenever a different agent is selected so output from one
  // agent never lingers under another.
  useEffect(() => {
    setTestInput('');
    setTestOutput('');
    setTesting(false);
  }, [selectedId]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/agents/defs', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.error || 'Failed to load agents'));
      setAgents(Array.isArray(data.agents) ? data.agents : []);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load agents');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const selectAgent = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoadingDef(true);
    setDef(null);
    setDraft(null);
    try {
      const res = await fetch(`/api/agents/defs/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.error || 'Failed to load agent'));
      const agent = data.agent as AgentDef;
      setDef(agent);
      setDraft(toEditable(agent));
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load agent');
      setSelectedId(null);
    } finally {
      setLoadingDef(false);
    }
  }, []);

  // Deep-link: `/agents/workspace?agent=<id>` (e.g. the Edit button on an agent's
  // detail page) opens that agent straight into the editor. Read on the client
  // to avoid a Suspense boundary; runs once. selectAgent fetches by id, so it
  // works whether or not the list has loaded.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('agent');
    if (want) selectAgent(want);
  }, [selectAgent]);

  const patch = useCallback(<K extends keyof Editable>(key: K, value: Editable[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const save = useCallback(async () => {
    if (!selectedId || !draft) return;
    if (!draft.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/defs/${encodeURIComponent(selectedId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          role: draft.role,
          model: draft.model,
          max_tokens: draft.max_tokens,
          rate_per_hour: draft.rate_per_hour,
          description: draft.description,
          soul: draft.soul,
          agent_md: draft.agent_md,
          skills: draft.skills,
          spawnable: draft.spawnable,
          enabled: draft.enabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'Save failed'));
      const agent = data.agent as AgentDef;
      setDef(agent);
      setDraft(toEditable(agent));
      toast.success('Saved');
      await loadList();
    } catch (e) {
      toast.error((e as Error).message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [draft, loadList, selectedId]);

  const remove = useCallback(async () => {
    if (!selectedId || !def) return;
    if (def.source !== 'custom') return;
    if (!window.confirm(`Delete agent "${def.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/defs/${encodeURIComponent(selectedId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'Delete failed'));
      toast.success('Agent deleted');
      setSelectedId(null);
      setDef(null);
      setDraft(null);
      await loadList();
    } catch (e) {
      toast.error((e as Error).message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }, [def, loadList, selectedId]);

  const runTest = useCallback(async () => {
    if (!selectedId || !draft) return;
    if (!testInput.trim()) {
      toast.error('Enter a sample input to test-run the agent');
      return;
    }
    setTesting(true);
    setTestOutput('');
    try {
      const res = await fetch(`/api/agents/defs/${encodeURIComponent(selectedId)}/test-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soul: draft.soul,
          agent_md: draft.agent_md,
          skills: draft.skills,
          model: draft.model,
          input: testInput,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'Test run failed'));
      setTestOutput(String(data?.text || ''));
    } catch (e) {
      toast.error((e as Error).message || 'Test run failed');
    } finally {
      setTesting(false);
    }
  }, [draft, selectedId, testInput]);

  const orchestrators = useMemo(
    () => agents.filter((a) => a.role === 'orchestrator'),
    [agents],
  );
  const specialists = useMemo(
    () => agents.filter((a) => a.role !== 'orchestrator'),
    [agents],
  );

  return (
    <div className="space-y-6 animate-in w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-h1 flex items-center gap-2">
            <Bot size={18} className="text-primary" /> Agent Studio
          </h1>
          <p className="text-xs text-muted-foreground">
            View, edit, and create the specialists KeyPlayer dispatches. Edits take effect live — no redeploy.
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm text-xs" onClick={loadList} disabled={loadingList}>
          <RefreshCw size={14} className={loadingList ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
        {/* LEFT: agent list — fixed narrow sidebar so the editor gets the room. */}
        <div className="panel">
          <div className="panel-header flex items-center justify-between">
            <div className="text-sm font-medium">Agents</div>
            <button
              type="button"
              className="btn btn-primary btn-sm text-xs"
              onClick={() => setShowNew(true)}
            >
              <Plus size={12} /> New agent
            </button>
          </div>

          <div className="panel-body space-y-4">
            {loadingList ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="px-3 py-2 rounded-lg border border-border/50 space-y-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                ))}
              </div>
            ) : agents.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No agents defined yet. Use “New agent” to create your first specialist.
              </div>
            ) : (
              <div className="space-y-4 max-h-[68vh] overflow-y-auto pr-1">
                {orchestrators.length > 0 && (
                  <AgentGroup
                    title="Orchestrator"
                    icon={<Crown size={11} />}
                    agents={orchestrators}
                    selectedId={selectedId}
                    onSelect={selectAgent}
                  />
                )}
                <AgentGroup
                  title="Specialists"
                  icon={<Bot size={11} />}
                  agents={specialists}
                  selectedId={selectedId}
                  onSelect={selectAgent}
                />
              </div>
            )}
          </div>
        </div>

      <Explainer
        id="agent-studio"
        title="What this is"
        what="The actual instructions each agent runs on. Edit one and it takes effect immediately — no deploy, no waiting."
        when="When an agent keeps getting something wrong, or you want it to sound more like you."
        example="Telling your outreach agent to never promise a delivery date."
        say="Or just say: “Stop signing emails with my full name.” Your assistant can make the change here."
      />

        {/* RIGHT: editor — fills the remaining width. */}
        <div className="panel min-w-0">
          {!selectedId ? (
            <div className="panel-body">
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground text-center px-6">
                Select an agent on the left to view and edit its definition, or create a new one.
              </div>
            </div>
          ) : loadingDef || !draft || !def ? (
            <div className="panel-body space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
              </div>
              <Skeleton className="h-16" />
              <Skeleton className="h-[460px]" />
            </div>
          ) : (
            <>
              <div className="panel-header flex items-center justify-between flex-wrap gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <span className="truncate">{draft.name || def.id}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">({def.id})</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                    <SourceBadge source={def.source} />
                    {/* Synthesized bundled defs carry an epoch-0 timestamp — show
                        "not saved yet" instead of a misleading 1969 date. */}
                    {new Date(def.updated_at).getTime() > 0 ? (
                      <span>Updated {new Date(def.updated_at).toLocaleString()}</span>
                    ) : (
                      <span>Not saved yet · bundled default</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-xs"
                    onClick={() => setShowWizard(true)}
                    disabled={saving || deleting}
                    title="Answer a few questions → generate this agent’s soul / instructions / skills"
                  >
                    <Wand2 size={14} /> Generate playbook
                  </button>
                  {def.source === 'custom' ? (
                    <button
                      type="button"
                      className="btn btn-destructive btn-sm text-xs"
                      onClick={remove}
                      disabled={deleting || saving}
                    >
                      <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm text-xs opacity-50 cursor-not-allowed"
                      disabled
                      title="Builtins can be disabled, not deleted."
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  )}
                  <button type="button" className="btn btn-primary btn-sm text-xs" onClick={save} disabled={saving}>
                    <Save size={14} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="panel-body space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Name</span>
                    <input
                      className="input text-sm"
                      value={draft.name}
                      onChange={(e) => patch('name', e.target.value)}
                      placeholder="Agent name"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Role</span>
                    <select
                      className="input text-sm"
                      value={draft.role}
                      onChange={(e) => patch('role', e.target.value as AgentRole)}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Model</span>
                    <ModelSelect value={draft.model} onChange={(v) => patch('model', v)} />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Max tokens</span>
                      <input
                        type="number"
                        min={0}
                        className="input text-sm font-mono"
                        value={draft.max_tokens}
                        onChange={(e) => patch('max_tokens', Number(e.target.value))}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Rate / hour</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="input text-sm font-mono"
                        value={draft.rate_per_hour}
                        onChange={(e) => patch('rate_per_hour', Number(e.target.value))}
                      />
                    </label>
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Description</span>
                  <textarea
                    className="input text-sm leading-relaxed"
                    rows={2}
                    value={draft.description}
                    onChange={(e) => patch('description', e.target.value)}
                    placeholder="What this agent is for…"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-5">
                  <Toggle
                    label="Enabled"
                    checked={draft.enabled}
                    onChange={(v) => patch('enabled', v)}
                  />
                  <Toggle
                    label="Spawnable"
                    checked={draft.spawnable}
                    onChange={(v) => patch('spawnable', v)}
                  />
                </div>

                <MonoField
                  label="Soul"
                  hint="Voice, values, and disposition."
                  value={draft.soul}
                  onChange={(v) => patch('soul', v)}
                />
                <MonoField
                  label="Agent"
                  hint="Operating instructions (AGENT.md)."
                  value={draft.agent_md}
                  onChange={(v) => patch('agent_md', v)}
                />
                <MonoField
                  label="Skills"
                  hint="Tools and capabilities."
                  value={draft.skills}
                  onChange={(v) => patch('skills', v)}
                />

                {/* Test-run sandbox — try the CURRENT (unsaved) draft on a sample
                    input before saving. Dry run: doesn't save, doesn't count as a
                    real task. */}
                <div className="rounded-lg border border-border/60 bg-muted/10">
                  <button
                    type="button"
                    onClick={() => setTestOpen((o) => !o)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
                  >
                    <span className="flex items-center gap-2 text-xs font-medium">
                      <FlaskConical size={14} className="text-primary" /> Test run
                      <span className="text-[10px] font-normal text-muted-foreground">
                        sandbox · doesn’t save or count as a task
                      </span>
                    </span>
                    {testOpen ? (
                      <ChevronDown size={14} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={14} className="text-muted-foreground" />
                    )}
                  </button>

                  {testOpen && (
                    <div className="px-3 pb-3 space-y-3 border-t border-border/60 pt-3">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Runs this draft (soul / instructions / skills, exactly as edited above)
                        once on your sample input — single-turn, no tools. Use it to iterate on the
                        definition before you Save. Nothing here is persisted.
                      </p>
                      <label className="block space-y-1">
                        <span className="text-xs text-muted-foreground">Sample input</span>
                        <textarea
                          className="input text-sm leading-relaxed"
                          rows={3}
                          value={testInput}
                          onChange={(e) => setTestInput(e.target.value)}
                          placeholder="e.g. Draft a LinkedIn post announcing our new pricing tier…"
                        />
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm text-xs"
                          onClick={runTest}
                          disabled={testing || !testInput.trim()}
                        >
                          {testing ? (
                            <>
                              <Loader2 size={14} className="animate-spin" /> Running…
                            </>
                          ) : (
                            <>
                              <Play size={14} /> Test run
                            </>
                          )}
                        </button>
                        {testOutput && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-xs"
                            onClick={() => setTestOutput('')}
                            disabled={testing}
                          >
                            Clear output
                          </button>
                        )}
                      </div>
                      {(testing || testOutput) && (
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">Output</span>
                          {testing && !testOutput ? (
                            <div className="rounded-lg border border-border/60 bg-background px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
                              <Loader2 size={14} className="animate-spin" /> Running the draft on your sample input…
                            </div>
                          ) : (
                            <pre className="rounded-lg border border-border/60 bg-background px-3 py-3 text-[13px] leading-6 whitespace-pre-wrap break-words max-h-[420px] overflow-y-auto">
                              {testOutput}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showNew && (
        <CreateAgentModal
          onClose={() => setShowNew(false)}
          onCreated={async (id) => {
            setShowNew(false);
            toast.success('Agent created');
            await loadList();
            await selectAgent(id);
          }}
        />
      )}

      {showWizard && draft && def && (
        <AgentPlaybookWizard
          agentId={def.id}
          agentName={draft.name || def.id}
          role={draft.role}
          onClose={() => setShowWizard(false)}
          onGenerated={(g) => {
            patch('soul', g.soul);
            patch('agent_md', g.agent_md);
            patch('skills', g.skills);
            if (g.description) patch('description', g.description);
            setShowWizard(false);
            toast.success('Definition generated — review the fields and Save');
          }}
        />
      )}
    </div>
  );
}

function AgentGroup({
  title,
  icon,
  agents,
  selectedId,
  onSelect,
}: {
  title: string;
  icon: React.ReactNode;
  agents: AgentSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="space-y-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          {icon} {title}
        </div>
        <div className="text-xs text-muted-foreground px-1">None</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        {icon} {title}
      </div>
      <div className="space-y-1">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id)}
            className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
              selectedId === a.id
                ? 'bg-primary/14 text-primary border-primary/30'
                : 'border-border/50 hover:bg-muted/30 hover:text-foreground'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{a.name}</span>
              <span
                className={`shrink-0 h-2 w-2 rounded-full ${a.enabled ? 'bg-success' : 'bg-muted-foreground/40'}`}
                title={a.enabled ? 'Enabled' : 'Disabled'}
                aria-label={a.enabled ? 'Enabled' : 'Disabled'}
              />
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground capitalize">{a.role}</span>
              <span className="text-[10px] font-mono text-muted-foreground truncate">{a.model}</span>
              <SourceBadge source={a.source} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: AgentSource }) {
  return (
    <span
      className={`badge border text-[10px] ${
        source === 'custom'
          ? 'bg-info/10 text-info border-info/30'
          : 'bg-muted/20 text-muted-foreground border-border'
      }`}
    >
      {source}
    </span>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-xs text-foreground">{label}</span>
    </label>
  );
}

function MonoField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      <textarea
        className="input font-mono text-[13px] leading-6 min-h-[460px] resize-y"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={`${label}…`}
      />
    </label>
  );
}

// New-agent creation now lives in CreateAgentModal (templates + built-in playbook
// questionnaire). The old bare id/name/role form was removed.
