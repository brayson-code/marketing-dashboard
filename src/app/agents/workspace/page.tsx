'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Crown, RefreshCw, Save, Trash2, Plus, X } from 'lucide-react';
import { toast } from '@/components/ui/toast';

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

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isSlug(v: string): boolean {
  return SLUG_RE.test(v);
}

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
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<AgentRole>('general');
  const [newModel, setNewModel] = useState('claude-opus-4-7');
  const [newDescription, setNewDescription] = useState('');

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

  const resetNewForm = useCallback(() => {
    setNewId('');
    setNewName('');
    setNewRole('general');
    setNewModel('claude-opus-4-7');
    setNewDescription('');
  }, []);

  const create = useCallback(async () => {
    const id = newId.trim();
    const name = newName.trim();
    if (!id || !name) {
      toast.error('ID and name are required');
      return;
    }
    if (!isSlug(id)) {
      toast.error('ID must be a slug: lowercase letters, digits, and hyphens');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/agents/defs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          role: newRole,
          model: newModel,
          max_tokens: 8000,
          rate_per_hour: 0,
          description: newDescription,
          soul: '',
          agent_md: '',
          skills: '',
          spawnable: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) throw new Error(String(data?.error || `Agent "${id}" already exists`));
        throw new Error(String(data?.error || 'Create failed'));
      }
      toast.success('Agent created');
      const created = data.agent as AgentDef;
      setShowNew(false);
      resetNewForm();
      await loadList();
      await selectAgent(created?.id || id);
    } catch (e) {
      toast.error((e as Error).message || 'Create failed');
    } finally {
      setCreating(false);
    }
  }, [loadList, newDescription, newId, newModel, newName, newRole, resetNewForm, selectAgent]);

  const orchestrators = useMemo(
    () => agents.filter((a) => a.role === 'orchestrator'),
    [agents],
  );
  const specialists = useMemo(
    () => agents.filter((a) => a.role !== 'orchestrator'),
    [agents],
  );

  const newIdValid = newId === '' || isSlug(newId);

  return (
    <div className="space-y-6 animate-in w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold flex items-center gap-2">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: agent list */}
        <div className="panel lg:col-span-1">
          <div className="panel-header flex items-center justify-between">
            <div className="text-sm font-medium">Agents</div>
            <button
              type="button"
              className="btn btn-sm text-xs"
              onClick={() => {
                resetNewForm();
                setShowNew(true);
              }}
            >
              <Plus size={12} /> New agent
            </button>
          </div>

          <div className="panel-body space-y-4">
            {loadingList ? (
              <div className="text-xs text-muted-foreground">Loading agents…</div>
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

        {/* RIGHT: editor */}
        <div className="panel lg:col-span-2">
          {!selectedId ? (
            <div className="panel-body">
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground text-center px-6">
                Select an agent on the left to view and edit its definition, or create a new one.
              </div>
            </div>
          ) : loadingDef || !draft || !def ? (
            <div className="panel-body">
              <div className="text-xs text-muted-foreground">Loading agent…</div>
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
                    <span>Updated {new Date(def.updated_at).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    <input
                      className="input text-sm font-mono"
                      value={draft.model}
                      onChange={(e) => patch('model', e.target.value)}
                      placeholder="claude-opus-4-7"
                    />
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
              </div>
            </>
          )}
        </div>
      </div>

      {showNew && (
        <NewAgentModal
          id={newId}
          name={newName}
          role={newRole}
          model={newModel}
          description={newDescription}
          idValid={newIdValid}
          creating={creating}
          onId={setNewId}
          onName={setNewName}
          onRole={setNewRole}
          onModel={setNewModel}
          onDescription={setNewDescription}
          onClose={() => {
            if (!creating) setShowNew(false);
          }}
          onCreate={create}
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
        className="input font-mono text-xs leading-relaxed min-h-[160px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={`${label}…`}
      />
    </label>
  );
}

function NewAgentModal({
  id,
  name,
  role,
  model,
  description,
  idValid,
  creating,
  onId,
  onName,
  onRole,
  onModel,
  onDescription,
  onClose,
  onCreate,
}: {
  id: string;
  name: string;
  role: AgentRole;
  model: string;
  description: string;
  idValid: boolean;
  creating: boolean;
  onId: (v: string) => void;
  onName: (v: string) => void;
  onRole: (v: AgentRole) => void;
  onModel: (v: string) => void;
  onDescription: (v: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-lg animate-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header flex items-center justify-between">
          <div className="text-sm font-medium flex items-center gap-2">
            <Plus size={14} className="text-primary" /> New agent
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={onClose}
            disabled={creating}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="panel-body space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">ID (slug)</span>
            <input
              className="input text-sm font-mono"
              value={id}
              onChange={(e) => onId(e.target.value)}
              placeholder="market-researcher"
              autoFocus
            />
            <span className={`text-[10px] ${idValid ? 'text-muted-foreground' : 'text-destructive'}`}>
              {idValid
                ? 'Lowercase letters, digits, and hyphens. Cannot be changed later.'
                : 'Invalid slug — use lowercase letters, digits, and hyphens only.'}
            </span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Name</span>
              <input
                className="input text-sm"
                value={name}
                onChange={(e) => onName(e.target.value)}
                placeholder="Market Researcher"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Role</span>
              <select
                className="input text-sm"
                value={role}
                onChange={(e) => onRole(e.target.value as AgentRole)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Model</span>
            <input
              className="input text-sm font-mono"
              value={model}
              onChange={(e) => onModel(e.target.value)}
              placeholder="claude-opus-4-7"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Starter description</span>
            <textarea
              className="input text-sm leading-relaxed"
              rows={2}
              value={description}
              onChange={(e) => onDescription(e.target.value)}
              placeholder="What this agent is for…"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/40">
          <button type="button" className="btn btn-ghost btn-sm text-xs" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm text-xs"
            onClick={onCreate}
            disabled={creating || !id.trim() || !name.trim() || !idValid}
          >
            <Plus size={14} /> {creating ? 'Creating…' : 'Create agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
