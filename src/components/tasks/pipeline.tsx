'use client';

// Pipeline view — renders an orchestrator campaign as a FLOW of parallel agent
// waves toward a goal, rather than a flat list. It conveys three things:
//   (1) SEQUENCE   — waves run in order (wave 0 -> 1 -> ... -> final/goal),
//                    drawn as connected stages.
//   (2) PARALLELISM — each wave's sub-agents are chips side-by-side inside the
//                    stage (they run at the same time).
//   (3) PROGRESS   — completed / current / upcoming stages are styled distinctly;
//                    current_wave highlights the active stage.
// Data comes from /api/pipeline (list) and /api/pipeline?id=... (detail), which
// reuse the wave_runs accessors. Polls every 3s.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Workflow,
  Target,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Circle,
  ChevronDown,
  ChevronRight,
  Flag,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface CampaignListItem {
  id: string;
  title: string;
  status: string;
  current_wave: number;
  total_waves: number;
  goal_id: string | null;
  updated_at: string;
}

interface AgentResult {
  agentId: string;
  task: string;
  ok: boolean;
  text: string | null;
  error: string | null;
  variant?: string;
}

interface Step {
  wave_index: number;
  label: string | null;
  status: string;
  synthesis: string | null;
  agent_results: AgentResult[] | null;
  started_at: string;
  finished_at: string | null;
}

interface Detail {
  campaign: Record<string, unknown>;
  steps: Step[];
}

// One stage in the rendered flow. Steps that exist in wave_step_runs carry real
// data; not-yet-run waves are synthesized as "upcoming" placeholders so the flow
// always shows the full path to the goal.
interface Stage {
  index: number;
  label: string;
  state: 'done' | 'running' | 'error' | 'current' | 'upcoming';
  step: Step | null;
}

function badgeFor(status: string): string {
  if (status === 'done') return 'badge-success';
  if (status === 'error') return 'badge-error';
  if (status === 'running') return 'badge-info';
  return 'badge-neutral';
}

function StageIcon({ state }: { state: Stage['state'] }) {
  if (state === 'running') return <Loader2 size={15} className="animate-spin text-primary" />;
  if (state === 'done') return <CheckCircle2 size={15} className="text-emerald-500" />;
  if (state === 'error') return <AlertCircle size={15} className="text-destructive" />;
  if (state === 'current') return <Circle size={15} className="text-primary" />;
  return <Circle size={15} className="text-muted-foreground/40" />;
}

// Status dot for a single agent chip within a wave.
function AgentDot({ ok }: { ok: boolean }) {
  return <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-destructive'}`} />;
}

export function Pipeline() {
  const [list, setList] = useState<CampaignListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [openWave, setOpenWave] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const loadList = useCallback(async () => {
    try {
      const r = await fetch('/api/pipeline', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load pipelines');
      setList(j.campaigns ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/pipeline?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load pipeline');
      // Only apply if this is still the campaign we're viewing.
      if (activeRef.current === id) setDetail(j.detail ?? null);
    } catch (e) {
      if (activeRef.current === id) setError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // First load + 3s poll of the list and (if one is selected) its detail.
  useEffect(() => {
    loadList();
    const t = setInterval(() => {
      loadList();
      if (activeRef.current) loadDetail(activeRef.current);
    }, 3000);
    return () => clearInterval(t);
  }, [loadList, loadDetail]);

  function select(id: string) {
    if (id === activeId) return;
    setActiveId(id);
    setDetail(null);
    setOpenWave(null);
    setDetailLoading(true);
    loadDetail(id);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* LEFT — campaign list */}
        <div className="panel divide-y divide-border/40 overflow-hidden self-start">
          {listLoading && list.length === 0 ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-4 w-12 rounded-full" />
                </div>
                <Skeleton className="h-2.5 w-14" />
              </div>
            ))
          ) : list.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">No pipelines yet.</div>
          ) : (
            list.map((it) => {
              // For an in-flight run, current_wave points at the wave about to
              // run; show it 1-based and clamp to total.
              const shown = Math.min(it.current_wave + (it.status === 'done' ? 0 : 1), it.total_waves);
              return (
                <button
                  key={it.id}
                  onClick={() => select(it.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    activeId === it.id ? 'bg-primary/10' : 'hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate flex-1">{it.title}</span>
                    <span className={`badge ${badgeFor(it.status)}`}>{it.status}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 rounded-full bg-[var(--surface-2)] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${it.status === 'error' ? 'bg-destructive' : 'bg-primary'}`}
                        style={{ width: `${it.total_waves ? (shown / it.total_waves) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      wave {shown}/{it.total_waves}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* RIGHT — flow */}
        <div className="min-w-0">
          {!activeId ? (
            list.length === 0 && !listLoading ? (
              <EmptyState />
            ) : (
              <div className="panel p-8 text-sm text-muted-foreground text-center flex flex-col items-center gap-2">
                <Workflow size={22} className="text-primary/70" />
                Select a pipeline to see how its agent waves flow toward the goal.
              </div>
            )
          ) : detailLoading && !detail ? (
            <FlowSkeleton />
          ) : detail ? (
            <Flow
              detail={detail}
              openWave={openWave}
              onToggleWave={(idx) => setOpenWave((w) => (w === idx ? null : idx))}
            />
          ) : (
            <FlowSkeleton />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="panel p-10 text-center flex flex-col items-center gap-3">
      <div className="rounded-full bg-primary/10 p-3">
        <Workflow size={24} className="text-primary" />
      </div>
      <div className="text-sm font-medium text-foreground">No pipelines yet</div>
      <p className="text-xs text-muted-foreground max-w-sm">
        When the orchestrator runs a campaign, its parallel agent waves appear here as a flow —
        each stage runs several agents at once, then synthesizes before the next wave begins.
      </p>
    </div>
  );
}

function FlowSkeleton() {
  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
      <div className="panel p-4 flex items-stretch gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-52 space-y-2 rounded-lg border border-border/60 bg-[var(--surface-2)] p-3">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-6 w-full rounded-md" />
              <Skeleton className="h-6 w-2/3 rounded-md" />
            </div>
            {i < 3 && <Skeleton className="h-3 w-6" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Flow({
  detail,
  openWave,
  onToggleWave,
}: {
  detail: Detail;
  openWave: number | null;
  onToggleWave: (idx: number) => void;
}) {
  const c = detail.campaign;
  const title = String(c.title ?? 'Pipeline');
  const status = String(c.status ?? 'running');
  const currentWave = Number(c.current_wave ?? 0);
  const totalWaves = Number(c.total_waves ?? detail.steps.length);
  const goalId = (c.goal_id as string | null) ?? null;
  const goalLabel = (c.goal_title as string | null) ?? goalId; // human title when resolved
  const finalReport = (c.final_report as string | null) ?? null;
  const campaignError = (c.error as string | null) ?? null;

  const stepsByIndex = new Map<number, Step>();
  for (const s of detail.steps) stepsByIndex.set(s.wave_index, s);

  // Build the full set of stages (run + not-yet-run) so the flow always shows
  // the complete path. Brief labels come from waves jsonb when available.
  const waveSpecs = Array.isArray(c.waves) ? (c.waves as Array<{ label?: string }>) : [];
  const stageCount = Math.max(totalWaves, detail.steps.length, waveSpecs.length);

  const stages: Stage[] = Array.from({ length: stageCount }).map((_, index) => {
    const step = stepsByIndex.get(index) ?? null;
    const specLabel = waveSpecs[index]?.label;
    const label = step?.label || specLabel || `Wave ${index + 1}`;
    let state: Stage['state'];
    if (step?.status === 'done') state = 'done';
    else if (step?.status === 'error') state = 'error';
    else if (step?.status === 'running') state = 'running';
    else if (status === 'running' && index === currentWave) state = 'current';
    else if (index < currentWave) state = 'done';
    else state = 'upcoming';
    return { index, label, state, step };
  });

  const shownWave = Math.min(currentWave + (status === 'done' ? 0 : 1), totalWaves);

  return (
    <div className="space-y-4 animate-in">
      {/* Header */}
      <div className="panel p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Workflow size={16} className="text-primary" /> {title}
            </h2>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>
                Wave {shownWave} of {totalWaves}
              </span>
              {goalId && (
                <>
                  · <span className="inline-flex items-center gap-1"><Target size={11} /> {goalLabel}</span>
                </>
              )}
            </div>
          </div>
          <span className={`badge ${badgeFor(status)} shrink-0`}>{status}</span>
        </div>
        {campaignError && <div className="text-xs text-destructive">Error: {campaignError}</div>}
      </div>

      {/* Flow diagram — horizontal stages connected by arrows. Scrolls on narrow
          screens; each stage shows its parallel agents as chips. */}
      <div className="panel p-4 overflow-x-auto">
        <div className="flex items-stretch gap-1 min-w-min">
          {stages.map((stage, i) => (
            <div key={stage.index} className="flex items-stretch gap-1">
              <StageNode stage={stage} open={openWave === stage.index} onToggle={() => onToggleWave(stage.index)} />
              {(i < stages.length - 1 || goalId) && <Connector active={stage.state === 'done'} />}
            </div>
          ))}
          {/* Terminal goal node */}
          {goalId && <GoalNode reached={status === 'done'} goalId={goalLabel ?? goalId} />}
        </div>
      </div>

      {/* Expanded wave detail (synthesis + per-agent output) */}
      {openWave !== null && stepsByIndex.get(openWave) && (
        <WaveDetail step={stepsByIndex.get(openWave)!} />
      )}

      {/* Final report */}
      {finalReport && (
        <div className="panel p-4">
          <div className="text-sm font-semibold flex items-center gap-2 mb-2">
            <Flag size={14} className="text-primary" /> Final report
          </div>
          <pre className="whitespace-pre-wrap text-xs leading-relaxed">{finalReport}</pre>
        </div>
      )}
    </div>
  );
}

function StageNode({ stage, open, onToggle }: { stage: Stage; open: boolean; onToggle: () => void }) {
  const agents = stage.step?.agent_results ?? null;
  const expandable = !!(stage.step && (stage.step.synthesis || (agents && agents.length > 0)));

  // Visual emphasis per state: current/running stages glow with the primary
  // ring; upcoming stages are dimmed.
  const ring =
    stage.state === 'running' || stage.state === 'current'
      ? 'border-primary/60 ring-1 ring-primary/30'
      : stage.state === 'error'
      ? 'border-destructive/50'
      : stage.state === 'done'
      ? 'border-emerald-500/40'
      : 'border-border/60';
  const dim = stage.state === 'upcoming' ? 'opacity-60' : '';

  return (
    <div className={`w-52 shrink-0 rounded-lg border bg-[var(--surface-2)] ${ring} ${dim} flex flex-col`}>
      <button
        onClick={onToggle}
        disabled={!expandable}
        className={`w-full text-left p-2.5 space-y-1.5 ${expandable ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-1.5">
          <StageIcon state={stage.state} />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Wave {stage.index + 1}</span>
          {expandable && (
            <ChevronDown size={13} className={`ml-auto text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
          )}
        </div>
        <div className="text-xs font-medium leading-snug line-clamp-2 text-foreground">{stage.label}</div>

        {/* Parallel agents as chips — conveys that this stage fans out. */}
        {agents && agents.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {agents.map((a, idx) => (
              <span
                key={idx}
                title={`${a.agentId}${a.variant && a.variant !== 'base' ? ` · ${a.variant}` : ''}\n${a.task}`}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-[var(--background)] px-1.5 py-0.5 text-[10px] text-foreground max-w-full"
              >
                <AgentDot ok={a.ok} />
                <span className="truncate">{a.agentId}</span>
                {a.variant && a.variant !== 'base' && (
                  <span className="text-[9px] text-muted-foreground">·{a.variant}</span>
                )}
              </span>
            ))}
          </div>
        ) : stage.state === 'running' ? (
          <div className="flex items-center gap-1 text-[10px] text-primary pt-0.5">
            <Loader2 size={10} className="animate-spin" /> agents running…
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground/70 pt-0.5">
            {stage.state === 'upcoming' ? 'upcoming' : 'pending'}
          </div>
        )}
      </button>
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex items-center px-0.5 self-center" aria-hidden="true">
      <div className={`h-px w-3 ${active ? 'bg-primary/60' : 'bg-border'}`} />
      <ChevronRight size={14} className={active ? 'text-primary/70' : 'text-muted-foreground/50'} />
    </div>
  );
}

function GoalNode({ reached, goalId }: { reached: boolean; goalId: string }) {
  return (
    <div
      title={`goal ${goalId}`}
      className={`w-40 shrink-0 self-center rounded-lg border p-3 flex flex-col items-center justify-center gap-1.5 text-center ${
        reached ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-primary/40 bg-primary/5'
      }`}
    >
      <Target size={18} className={reached ? 'text-emerald-500' : 'text-primary'} />
      <div className="text-[11px] font-medium text-foreground">Goal</div>
      <div className="text-[10px] text-muted-foreground truncate max-w-full">{goalId}</div>
      {reached && <span className="badge badge-success">reached</span>}
    </div>
  );
}

function WaveDetail({ step }: { step: Step }) {
  const agents = step.agent_results ?? [];
  return (
    <div className="panel p-4 space-y-3 animate-in">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium flex-1">{step.label || `Wave ${step.wave_index + 1}`}</span>
        <span className={`badge ${badgeFor(step.status)}`}>{step.status}</span>
      </div>

      {step.synthesis && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Synthesis (passed to next wave)
          </div>
          <pre className="whitespace-pre-wrap bg-[var(--surface-2)] rounded-md p-2.5 text-xs leading-relaxed">
            {step.synthesis}
          </pre>
        </div>
      )}

      {agents.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {agents.length} parallel agents
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {agents.map((a, i) => (
              <div key={i} className="border border-border/40 rounded-md p-2.5 bg-[var(--surface-2)]">
                <div className="flex items-center gap-1.5 text-[11px] font-medium mb-0.5">
                  <AgentDot ok={a.ok} />
                  <span className="text-foreground">{a.agentId}</span>
                  {a.variant && a.variant !== 'base' && (
                    <span className="text-[10px] text-muted-foreground">· {a.variant}</span>
                  )}
                  <span className={`badge ${a.ok ? 'badge-success' : 'badge-error'} ml-auto`}>
                    {a.ok ? 'ok' : 'error'}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground mb-1">{a.task}</div>
                <pre className="whitespace-pre-wrap text-[11px] max-h-48 overflow-y-auto leading-relaxed text-foreground">
                  {a.ok ? a.text : a.error}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default Pipeline;
