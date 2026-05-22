'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Waves, Loader2, Play, ChevronDown, FileText, Target, AlertTriangle } from 'lucide-react';
import { toast } from '@/components/ui/toast';
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
}
interface Detail { campaign: Campaign; steps: Step[] }

function statusPill(status: string) {
  if (status === 'done') return 'status-pill status-ok';
  if (status === 'error') return 'status-pill status-danger';
  if (status === 'running') return 'status-pill status-neutral';
  return 'status-pill status-warn';
}

export default function CampaignsPage() {
  const [list, setList] = useState<CampaignListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [request, setRequest] = useState('');
  const [launching, setLaunching] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [openWave, setOpenWave] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch('/api/campaigns', { cache: 'no-store' });
      if (r.ok) setList((await r.json()).campaigns ?? []);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const r = await fetch(`/api/campaigns/${id}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      // Only apply if this is still the campaign we're viewing.
      setDetail((prev) => (j?.campaign?.id === id ? j : prev));
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (activeId) loadDetail(activeId); }, [activeId, loadDetail]);

  // Poll the active campaign while a wave is in flight.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const running = detail?.campaign.status === 'running';
    const inFlight = detail?.steps.some((s) => s.status === 'running');
    if (activeId && (running || inFlight)) {
      pollRef.current = setInterval(() => { loadDetail(activeId); loadList(); }, 12_000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeId, detail?.campaign.status, detail?.steps, loadDetail, loadList]);

  async function launch() {
    if (!request.trim() || launching) return;
    setLaunching(true);
    try {
      const r = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: request.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Launch failed');
      toast.success('Campaign launched — wave 1 running');
      setRequest('');
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
      const r = await fetch(`/api/campaigns/${activeId}/advance`, { method: 'POST' });
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

  return (
    <div className="space-y-4 animate-in">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold flex items-center gap-2"><Waves size={18} className="text-primary" /> Research Campaigns</h1>
        <p className="text-xs text-muted-foreground">Parallel agent waves. Describe what to research — KeyPlayer drafts a brief, sets a goal, and runs 4 waves of agents. Advance wave-by-wave; the report files into the knowledge base.</p>
      </div>

      {/* Launch */}
      <div className="panel p-3 space-y-2">
        <textarea
          className="w-full input text-sm min-h-[60px]"
          placeholder="e.g. Research the US market for AI-powered email outreach tools for small B2B agencies — sizing, top competitors, pricing, and the best channel to reach buyers."
          value={request}
          onChange={(e) => setRequest(e.target.value)}
        />
        <div className="flex justify-end">
          <button className="btn btn-primary btn-sm" onClick={launch} disabled={launching || !request.trim()}>
            {launching ? <Loader2 size={14} className="animate-spin" /> : <Waves size={14} />} Launch campaign
          </button>
        </div>
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
            <div className="p-4 text-xs text-muted-foreground">No campaigns yet.</div>
          ) : list.map((it) => (
            <button key={it.id} onClick={() => { setActiveId(it.id); setOpenWave(null); }}
              className={`w-full text-left px-3 py-2.5 transition-colors ${activeId === it.id ? 'bg-primary/10' : 'hover:bg-[var(--surface-2)]'}`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium truncate flex-1">{it.title}</span>
                <span className={statusPill(it.status)}>{it.status}</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Wave {Math.min(it.current_wave + (it.status === 'done' ? 0 : 1), it.total_waves)}/{it.total_waves}</div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="min-w-0 space-y-3">
          {!c ? (
            activeId && detail?.campaign.id !== activeId ? (
              <CampaignDetailSkeleton />
            ) : (
              <div className="panel p-8 text-sm text-muted-foreground text-center">Select or launch a campaign.</div>
            )
          ) : (
            <>
              <div className="panel p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{c.title}</h2>
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
                {c.error && <div className="text-xs text-destructive">Error: {c.error}</div>}
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
