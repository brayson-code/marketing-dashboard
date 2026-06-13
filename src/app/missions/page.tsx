'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Waves, Loader2, Play, ChevronDown, FileText, Target, AlertTriangle, Layers, ListChecks, Users, X, PauseCircle } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Explainer } from '@/components/ui/explainer';

interface CampaignListItem {
  id: string;
  title: string;
  status: string;
  current_wave: number;
  total_waves: number;
  goal_id: string | null;
  campaign_id?: string | null;
  updated_at: string;
}
interface AgentResult { agentId: string; task: string; ok: boolean; text: string | null; error: string | null }
interface Step {
  wave_index: number;
  label: string | null;
  status: string;
  synthesis: string | null;
  agent_results: AgentResult[] | null;
}
interface Brief { objective: string; success: string; audience?: string; constraints?: string; risks?: string[] }
interface Campaign {
  id: string; title: string; status: string; current_wave: number; total_waves: number;
  goal_id: string | null; brief: Brief; final_report: string | null; request: string | null; error: string | null;
  campaign_id?: string | null;
}
interface Detail { campaign: Campaign; steps: Step[] }

// A composed wave plan returned by the plan-preview step (POST /api/missions
// { action: 'plan' }). Surfaced before launch so the owner sees which waves +
// agents will run for their objective.
interface PlannedWave { title: string; goal: string; agent_ids: string[]; prompt_directives: string }
interface WavePlan { objective_type: string; waves: PlannedWave[]; final_deliverable: string }
interface PlanPreview { title: string; brief: Brief & { objective_type?: string }; plan: WavePlan }

// Tiny module-level cache so we fetch each campaign's title at most once across
// chip renders (the missions page can show many missions tagged to the same one).
const campaignTitleCache = new Map<string, string>();

/** Small badge linking a mission to its parent Campaign (/campaigns/[id]). */
function CampaignChip({ campaignId }: { campaignId: string }) {
  const [title, setTitle] = useState<string | null>(() => campaignTitleCache.get(campaignId) ?? null);
  useEffect(() => {
    // The initial state already seeds from the cache, so skip the fetch when we
    // already have the title (avoids a synchronous setState inside the effect).
    if (campaignTitleCache.has(campaignId)) return;
    let alive = true;
    fetch(`/api/campaigns/${campaignId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const name: string | undefined = j?.campaign?.name;
        if (name) campaignTitleCache.set(campaignId, name);
        if (alive && name) setTitle(name);
      })
      .catch(() => { /* leave the generic "Campaign" label */ });
    return () => { alive = false; };
  }, [campaignId]);
  return (
    <Link
      href={`/campaigns/${campaignId}`}
      className="badge badge-info inline-flex items-center gap-1 hover:opacity-80"
      title={title ? `In campaign: ${title}` : 'In a campaign'}
    >
      <Layers size={10} /> {title ?? 'Campaign'}
    </Link>
  );
}

function statusPill(status: string) {
  if (status === 'done') return 'status-pill status-ok';
  if (status === 'error') return 'status-pill status-danger';
  if (status === 'running') return 'status-pill status-neutral';
  if (status === 'paused') return 'status-pill status-warn';
  return 'status-pill status-warn';
}

export default function MissionsPage() {
  const [list, setList] = useState<CampaignListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [request, setRequest] = useState('');
  const [launching, setLaunching] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [openWave, setOpenWave] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadList = useCallback(async () => {
    try {
      // Bound the request so a stalled fetch can't leave the page skeleton-loading
      // forever — listLoading flips false in the finally regardless, but the abort
      // guarantees the await actually settles even if the network hangs.
      const r = await fetch('/api/missions', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (r.ok) setList((await r.json()).missions ?? []);
    } catch {
      /* timeout / network — fall through to the empty state, not an endless skeleton */
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/missions/${id}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        const j = await r.json();
        // Only apply if this is still the mission we're viewing.
        setDetail((prev) => (j?.campaign?.id === id ? j : prev));
      }
    } catch {
      /* timeout / network — leave prior detail; the poll will retry */
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (activeId) loadDetail(activeId); }, [activeId, loadDetail]);

  // Poll the active mission while a wave is in flight.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const running = detail?.campaign.status === 'running';
    const inFlight = detail?.steps.some((s) => s.status === 'running');
    if (activeId && (running || inFlight)) {
      pollRef.current = setInterval(() => { loadDetail(activeId); loadList(); }, 12_000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeId, detail?.campaign.status, detail?.steps, loadDetail, loadList]);

  // Plan-preview: compose the wave plan WITHOUT launching, so the owner sees the
  // waves + agents that will run for their objective before committing.
  async function previewPlan() {
    if (!request.trim() || previewing || launching) return;
    setPreviewing(true);
    try {
      const r = await fetch('/api/missions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'plan', request: request.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not plan that');
      setPreview(j as PlanPreview);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function launch() {
    if (!request.trim() || launching) return;
    setLaunching(true);
    try {
      const r = await fetch('/api/missions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: request.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Launch failed');
      toast.success('Mission launched — wave 1 running');
      setRequest('');
      setPreview(null);
      setActiveId(j.id);
      await loadList();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }

  async function advance() {
    if (!activeId || advancing) return;
    setAdvancing(true);
    // Optimistic: show the next wave running immediately. Advancing almost
    // always succeeds; revert from the server response on failure.
    const prevDetail = detail;
    setDetail((d) => {
      if (!d) return d;
      const nextWaveIndex = d.campaign.current_wave;
      const hasStep = d.steps.some((s) => s.wave_index === nextWaveIndex);
      const steps = hasStep
        ? d.steps.map((s) => (s.wave_index === nextWaveIndex ? { ...s, status: 'running' } : s))
        : [...d.steps, { wave_index: nextWaveIndex, label: null, status: 'running', synthesis: null, agent_results: null }];
      return { ...d, campaign: { ...d.campaign, status: 'running' }, steps };
    });
    try {
      const r = await fetch(`/api/missions/${activeId}/advance`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Advance failed');
      toast.success('Running next wave…');
      setTimeout(() => loadDetail(activeId), 1500);
    } catch (e) {
      setDetail(prevDetail); // revert the optimistic update
      toast.error((e as Error).message);
    } finally {
      setAdvancing(false);
    }
  }

  const c = detail?.campaign;
  const canAdvance = c && c.status === 'running' && c.current_wave < c.total_waves && !detail?.steps.some((s) => s.status === 'running');
  // A paused mission was held by the daily token budget. Resume = re-call advance;
  // the gate will pass once the tenant is back under budget or the cap is raised.
  const canResume = c && c.status === 'paused';

  return (
    <div className="space-y-4 animate-in">
      <div className="space-y-1">
        <h1 className="text-h1 flex items-center gap-2"><Waves size={18} className="text-primary" /> Missions</h1>
        <p className="text-xs text-muted-foreground">Parallel agent waves. Describe what to research — KeyPlayer drafts a brief, sets a goal, and runs 4 waves of agents. Advance wave-by-wave; the report files into the knowledge base.</p>
      </div>

      <Explainer
        id="missions"
        title="Missions"
        what="one execution run where several agents work in parallel 'waves' toward a goal."
        when="you want the team to go do a chunk of work now (research, build, outreach) — not just plan it."
        example="'Research our top 5 competitors' positioning' → 4 agent waves → a report filed in your knowledge base."
      />

      {/* Launch */}
      <div className="panel p-3 space-y-2">
        <textarea
          className="w-full input text-sm min-h-[60px]"
          placeholder="e.g. Research the US market for AI-powered email outreach tools for small B2B agencies — sizing, top competitors, pricing, and the best channel to reach buyers."
          value={request}
          onChange={(e) => { setRequest(e.target.value); if (preview) setPreview(null); }}
        />
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost btn-sm" onClick={previewPlan} disabled={previewing || launching || !request.trim()}>
            {previewing ? <Loader2 size={14} className="animate-spin" /> : <ListChecks size={14} />} Preview plan
          </button>
          <button className="btn btn-primary btn-sm" onClick={launch} disabled={launching || !request.trim()}>
            {launching ? <Loader2 size={14} className="animate-spin" /> : <Waves size={14} />} Launch mission
          </button>
        </div>

        {/* Plan preview — the composed waves + agents for this objective, shown
            before launch so the owner confirms the team and order. */}
        {preview && (
          <div className="rounded-md border border-border/60 bg-[var(--surface-2)] p-3 space-y-2 animate-in">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{preview.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  <span className="badge badge-neutral">{preview.plan.objective_type}</span>
                  <span className="ml-1.5">{preview.plan.waves.length} waves · delivers: {preview.plan.final_deliverable}</span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm px-1.5" onClick={() => setPreview(null)} aria-label="Dismiss plan preview">
                <X size={14} />
              </button>
            </div>
            <ol className="space-y-1.5">
              {preview.plan.waves.map((w, i) => (
                <li key={i} className="rounded-md bg-[var(--surface-1)] p-2">
                  <div className="text-xs font-medium">{w.title}</div>
                  <div className="text-[11px] text-muted-foreground">{w.goal}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                    <Users size={10} className="text-muted-foreground" />
                    {w.agent_ids.map((a, j) => (
                      <span key={j} className="badge badge-info">{a}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex justify-end">
              <button className="btn btn-primary btn-sm" onClick={launch} disabled={launching}>
                {launching ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Launch this plan
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* List */}
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
            <div className="p-4 text-xs text-muted-foreground">No missions yet.</div>
          ) : list.map((it) => (
            <button key={it.id} onClick={() => { setActiveId(it.id); setOpenWave(null); }}
              className={`w-full text-left px-3 py-2.5 transition-colors ${activeId === it.id ? 'bg-primary/10' : 'hover:bg-[var(--surface-2)]'}`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium truncate flex-1">{it.title}</span>
                <span className={statusPill(it.status)}>{it.status}</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5">
                <span>Wave {Math.min(it.current_wave + (it.status === 'done' ? 0 : 1), it.total_waves)}/{it.total_waves}</span>
                {it.campaign_id && <span className="inline-flex items-center gap-0.5 text-[var(--info)]" title="In a campaign"><Layers size={9} /> campaign</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="min-w-0 space-y-3">
          {!c ? (
            activeId && detail?.campaign.id !== activeId ? (
              <CampaignDetailSkeleton />
            ) : (
              <div className="panel p-8 text-sm text-muted-foreground text-center">Select or launch a mission.</div>
            )
          ) : (
            <>
              <div className="panel p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold">{c.title}</h2>
                      {c.campaign_id
                        ? <CampaignChip campaignId={c.campaign_id} />
                        : <span className="badge badge-neutral">Standalone</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Wave {Math.min(c.current_wave + (c.status === 'done' ? 0 : 1), c.total_waves)} of {c.total_waves}
                      {c.goal_id && <> · <span className="inline-flex items-center gap-1"><Target size={11} /> goal {c.goal_id}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={statusPill(c.status)}>{c.status}</span>
                    {canAdvance && (
                      <button className="btn btn-primary btn-sm" onClick={advance} disabled={advancing}>
                        {advancing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run next wave
                      </button>
                    )}
                    {canResume && (
                      <button className="btn btn-primary btn-sm" onClick={advance} disabled={advancing}>
                        {advancing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Resume
                      </button>
                    )}
                  </div>
                </div>

                {/* Brief */}
                <div className="text-xs space-y-1.5 bg-[var(--surface-2)] rounded-md p-3">
                  <div><span className="text-muted-foreground">Objective:</span> {c.brief?.objective}</div>
                  <div><span className="text-muted-foreground">Success:</span> {c.brief?.success}</div>
                  {c.brief?.risks && c.brief.risks.length > 0 && (
                    <div className="pt-1">
                      <div className="text-muted-foreground flex items-center gap-1"><AlertTriangle size={11} /> Questions to sit with:</div>
                      <ul className="list-disc ml-5 mt-1 space-y-0.5">
                        {c.brief.risks.map((q, i) => <li key={i}>{q}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
                {c.status === 'paused' && (
                  <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
                    <PauseCircle size={13} className="mt-0.5 shrink-0" />
                    <span>
                      Agents paused — daily token budget reached. They resume automatically
                      tomorrow, or{' '}
                      <Link href="/settings" className="underline underline-offset-2">
                        raise the cap in Settings
                      </Link>
                      . Hit &ldquo;Resume&rdquo; once under budget to continue now.
                    </span>
                  </div>
                )}
                {c.status !== 'paused' && c.error && <div className="text-xs text-destructive">Error: {c.error}</div>}
              </div>

              {/* Waves */}
              <div className="space-y-2">
                {detail!.steps.map((s) => (
                  <div key={s.wave_index} className="panel">
                    <button onClick={() => setOpenWave(openWave === s.wave_index ? null : s.wave_index)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
                      {s.status === 'running' ? <Loader2 size={13} className="animate-spin text-primary" /> : <ChevronDown size={14} className={`transition-transform ${openWave === s.wave_index ? 'rotate-180' : ''}`} />}
                      <span className="text-sm font-medium flex-1">{s.label || `Wave ${s.wave_index + 1}`}</span>
                      <span className={statusPill(s.status)}>{s.status}</span>
                    </button>
                    {openWave === s.wave_index && (
                      <div className="px-3 pb-3 space-y-2 text-xs">
                        {s.synthesis && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Synthesis (passed to next wave)</div>
                            <pre className="whitespace-pre-wrap bg-[var(--surface-2)] rounded-md p-2 leading-relaxed">{s.synthesis}</pre>
                          </div>
                        )}
                        {s.agent_results && (
                          <details>
                            <summary className="cursor-pointer text-muted-foreground">{s.agent_results.length} parallel agents</summary>
                            <div className="mt-2 space-y-2">
                              {s.agent_results.map((a, i) => (
                                <div key={i} className="border border-border/40 rounded-md p-2">
                                  <div className="text-[11px] font-medium">{a.agentId} · {a.ok ? 'ok' : 'error'}</div>
                                  <div className="text-[10px] text-muted-foreground mb-1">{a.task}</div>
                                  <pre className="whitespace-pre-wrap text-[11px] max-h-48 overflow-y-auto">{a.ok ? a.text : a.error}</pre>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Final report */}
              {c.final_report && (
                <div className="panel p-4">
                  <div className="text-sm font-semibold flex items-center gap-2 mb-2"><FileText size={14} className="text-primary" /> Final report <span className="text-[10px] text-muted-foreground font-normal">(also filed to Memory → &quot;{c.title} — research report&quot;)</span></div>
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed">{c.final_report}</pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CampaignDetailSkeleton() {
  return (
    <>
      <div className="panel p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="bg-[var(--surface-2)] rounded-md p-3 space-y-2">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="panel px-3 py-2.5 flex items-center gap-2">
            <Skeleton className="h-3.5 w-3.5 rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </>
  );
}
