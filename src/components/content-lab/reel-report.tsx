'use client';

import { useState } from 'react';
import {
  Play, AlertCircle, RotateCcw, Sparkles, Target, CheckCircle2,
  TriangleAlert, Wand2, Clock, Captions, ArrowRight,
} from 'lucide-react';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { ReelPlayerModal, extractShortcode } from '@/components/competitors/reel-embed';
import type { ReelScan } from '@/lib/reel-scans';

// Goal metadata lives here (a component module — exports are fine) rather than in
// page.tsx, where Next forbids non-Next exports. The page imports it from here.
// Each goal carries a label + brand color used for the badge + report header.
export type ScanGoal = 'views' | 'retention' | 'sales' | 'engagement' | 'general';
export const GOAL_OPTIONS: ScanGoal[] = ['views', 'retention', 'sales', 'engagement', 'general'];
export const GOAL_META: Record<string, { label: string; color: string }> = {
  views:      { label: 'Views',      color: 'var(--info)' },
  retention:  { label: 'Retention',  color: 'var(--primary)' },
  sales:      { label: 'Sales',      color: 'var(--success)' },
  engagement: { label: 'Engagement', color: 'var(--warning)' },
  general:    { label: 'General',    color: 'var(--muted-foreground)' },
};

// Renders ONE reel self-scan: the killer "teardown + rewrites" surface of the
// Content Lab. Three states keyed off scan.status:
//   scanning → a shaped skeleton ("Scoring your reel…")
//   error    → the error message + a Retry affordance
//   done     → the 5 scores as banded bars, verdict + summary, strengths chips,
//              weak points (timestamp badge + issue + fix), and the REWRITES as
//              Currently → Try → Expected-impact cards (made prominent).
// Pure presentation over the shared ReelScan contract; all data arrives via REST.

export interface ReelReportProps {
  scan: ReelScan;
  /** Re-run this scan (re-POST). Wired by the page; shown on the error state. */
  onRetry: () => void;
  retrying?: boolean;
}

// The five scored dimensions, in display order, with human labels.
const SCORE_ROWS: { key: keyof NonNullable<ReelScan['scores']>; label: string }[] = [
  { key: 'voiceImpact', label: 'Voice impact' },
  { key: 'visualPull', label: 'Visual pull' },
  { key: 'cognitiveGrip', label: 'Cognitive grip' },
  { key: 'emotionalHit', label: 'Emotional hit' },
  { key: 'memorability', label: 'Memorability' },
];

export function ReelReport({ scan, onRetry, retrying }: ReelReportProps) {
  const [playing, setPlaying] = useState(false);
  const canPlay = extractShortcode(scan.url) != null;
  const goal = GOAL_META[scan.goal] ?? GOAL_META.general;

  return (
    <div className="panel overflow-hidden">
      {playing && <ReelPlayerModal url={scan.url} onClose={() => setPlaying(false)} />}

      {/* Header — goal badge + the source URL + play affordance */}
      <div className="panel-header">
        <div className="min-w-0 flex items-center gap-2">
          <h3 className="text-h2 truncate">Reel teardown</h3>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium leading-none border shrink-0"
            style={goalChipStyle(goal.color)}
            title={`Scored for ${goal.label.toLowerCase()}`}
          >
            <Target size={10} /> {goal.label}
          </span>
        </div>
        <button
          type="button"
          onClick={() => (canPlay ? setPlaying(true) : window.open(scan.url, '_blank', 'noreferrer'))}
          className="btn btn-ghost btn-sm shrink-0"
        >
          <Play size={13} /> Play the reel
        </button>
      </div>

      <div className="panel-body">
        {scan.status === 'scanning' ? (
          <ScanningState />
        ) : scan.status === 'error' ? (
          <ErrorState error={scan.error} onRetry={onRetry} retrying={retrying} />
        ) : (
          <DoneState scan={scan} />
        )}
      </div>
    </div>
  );
}

// ─── scanning ─────────────────────────────────────────────────────────────────

function ScanningState() {
  return (
    <div className="space-y-5">
      <p className="text-small text-muted-foreground inline-flex items-center gap-2">
        <Sparkles size={14} className="text-primary animate-pulse" /> Scoring your reel…
      </p>
      {/* score bars skeleton */}
      <div className="space-y-2.5">
        {SCORE_ROWS.map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 flex-1 rounded-full" />
            <Skeleton className="h-3 w-7" />
          </div>
        ))}
      </div>
      <SkeletonText lines={3} />
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
    </div>
  );
}

// ─── error ────────────────────────────────────────────────────────────────────

function ErrorState({ error, onRetry, retrying }: { error: string | null; onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-6">
      <span className="h-10 w-10 rounded-full grid place-items-center bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)] text-destructive">
        <AlertCircle size={20} />
      </span>
      <div className="space-y-1">
        <p className="text-small font-medium text-foreground">Scan failed</p>
        <p className="text-micro text-muted-foreground max-w-sm">{error || 'Something went wrong while scoring this reel.'}</p>
      </div>
      <button type="button" onClick={onRetry} disabled={retrying} className="btn btn-ghost btn-sm">
        <RotateCcw size={13} className={retrying ? 'animate-spin' : ''} /> {retrying ? 'Retrying…' : 'Retry scan'}
      </button>
    </div>
  );
}

// ─── done ─────────────────────────────────────────────────────────────────────

function DoneState({ scan }: { scan: ReelScan }) {
  const { scores, report } = scan;

  return (
    <div className="space-y-5">
      {/* SCORES — banded bars */}
      {scores && (
        <div className="space-y-2.5">
          {SCORE_ROWS.map(({ key, label }) => (
            <ScoreBar key={key} label={label} value={scores[key]} />
          ))}
        </div>
      )}

      {/* caption-only note */}
      {!scan.had_transcript && (
        <p className="text-micro text-muted-foreground inline-flex items-start gap-1.5 rounded-md border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] px-2.5 py-1.5">
          <Captions size={12} className="mt-px shrink-0" />
          Scored from caption only — add a Deepgram key for spoken-word analysis.
        </p>
      )}

      {report && (
        <>
          {/* VERDICT + SUMMARY */}
          {(report.verdict || report.summary) && (
            <div className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-3 space-y-1.5">
              {report.verdict && (
                <p className="text-small font-semibold text-foreground inline-flex items-center gap-1.5">
                  <Sparkles size={13} className="text-primary" /> {report.verdict}
                </p>
              )}
              {report.summary && (
                <p className="text-small text-muted-foreground leading-relaxed whitespace-pre-wrap">{report.summary}</p>
              )}
            </div>
          )}

          {/* STRENGTHS — chips */}
          {report.strengths?.length > 0 && (
            <Section icon={<CheckCircle2 size={13} className="text-[var(--success)]" />} title="Strengths">
              <div className="flex flex-wrap gap-1.5">
                {report.strengths.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium leading-none border bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)] border-[color-mix(in_srgb,var(--success)_45%,transparent)]"
                  >
                    <CheckCircle2 size={11} /> {s}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* WEAK POINTS — timestamp badge + issue + fix */}
          {report.weakPoints?.length > 0 && (
            <Section icon={<TriangleAlert size={13} className="text-[var(--warning)]" />} title="Weak points">
              <div className="space-y-2">
                {report.weakPoints.map((w, i) => (
                  <div key={i} className="rounded-lg border border-border/50 p-2.5">
                    <div className="flex items-start gap-2">
                      {w.timestamp && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums leading-none bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-[var(--warning)] shrink-0 mt-px">
                          <Clock size={9} /> {w.timestamp}
                        </span>
                      )}
                      <p className="text-xs font-medium text-foreground leading-snug">{w.issue}</p>
                    </div>
                    {w.fix && (
                      <p className="text-xs text-muted-foreground leading-relaxed mt-1.5 pl-0.5">
                        <span className="text-[var(--success)] font-medium">Fix:</span> {w.fix}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* REWRITES — the killer feature: Currently → Try → Expected impact */}
          {report.rewrites?.length > 0 && (
            <Section icon={<Wand2 size={13} className="text-primary" />} title="Rewrites">
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {report.rewrites.map((rw, i) => (
                  <div key={i} className="rounded-lg border border-border/60 bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-border/50 flex items-center gap-1.5">
                      <Wand2 size={12} className="text-primary" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">{rw.category}</span>
                    </div>
                    <div className="p-3 space-y-2.5 flex-1">
                      {/* currently */}
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70">Currently</p>
                        <p className="text-xs leading-relaxed text-muted-foreground line-through decoration-[color-mix(in_srgb,var(--destructive)_60%,transparent)] decoration-1">
                          {rw.currently}
                        </p>
                      </div>
                      {/* try this */}
                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-primary inline-flex items-center gap-1">
                          <ArrowRight size={10} /> Try
                        </p>
                        <p className="text-xs leading-relaxed font-medium text-foreground">{rw.suggestion}</p>
                      </div>
                      {/* expected impact */}
                      {rw.expectedImpact && (
                        <p className="text-[11px] leading-relaxed text-[var(--success)] inline-flex items-start gap-1.5 border-t border-border/40 pt-2 mt-auto">
                          <Sparkles size={11} className="mt-px shrink-0" /> {rw.expectedImpact}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// ─── pieces ───────────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = bandColor(v);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${v}%`, background: color, transition: 'width var(--t-modal) var(--ease-out)' }}
        />
      </div>
      <span className="text-xs font-mono tabular-nums font-semibold w-7 text-right" style={{ color }}>{v}</span>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-micro uppercase tracking-wider text-muted-foreground/70 font-semibold inline-flex items-center gap-1.5">
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// Score band → color: red <40, amber <70, green >=70.
function bandColor(v: number): string {
  if (v < 40) return 'var(--destructive)';
  if (v < 70) return 'var(--warning)';
  return 'var(--success)';
}

function goalChipStyle(color: string): React.CSSProperties {
  return {
    background: `color-mix(in srgb, ${color} 14%, transparent)`,
    color,
    borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
  };
}
