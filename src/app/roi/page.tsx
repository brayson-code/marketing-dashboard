'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Timer,
  DollarSign,
  TrendingUp,
  AlertCircle,
  Check,
  Save,
  SlidersHorizontal,
  PenLine,
  MessageCircle,
  CalendarClock,
  Search,
  ShieldCheck,
  Video,
  Image as ImageIcon,
  BarChart3,
  Sparkles,
  ArrowRight,
  Minus,
  Plus,
  ChevronDown,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { Explainer } from '@/components/ui/explainer';

interface KeyAudit {
  annual_revenue: number | null;
  annual_profit: number | null;
  hours_per_week: number | null;
  admin_percentage: number | null;
  presets: Record<string, number>;
  updated_at: string | null;
}
interface RoiSummary {
  audit: KeyAudit;
  hoursSavedAllTime: number;
  hoursSavedThisMonth: number;
  valueReclaimed: number;
  oldDollarPerHour: number | null;
  newDollarPerHour: number | null;
  projectedAnnualValue: number | null;
  byAgent: Array<{ agent_id: string | null; hours: number; value: number }>;
  byMonth: Array<{ month: string; hours: number; value: number }>;
  hasActuals: boolean;
}

const INPUT = 'px-3 py-2 rounded-lg border border-border bg-background text-sm w-full';
const fmtUsd = (n: number | null) => (n == null || !Number.isFinite(n) ? '—' : `$${Math.round(n).toLocaleString()}`);
const fmtHrs = (n: number) => { const h = Number.isFinite(n) ? n : 0; return `${h.toFixed(h < 10 ? 1 : 0)} hrs`; };
const WEEKS = 52;

// Read a human error message off a failed response without letting a non-JSON
// body (empty / HTML error page) throw a confusing "Unexpected end of JSON input".
async function errMsg(res: Response, fallback: string): Promise<string> {
  try {
    const raw = await res.text();
    if (raw) { try { return (JSON.parse(raw) as { error?: string }).error || fallback; } catch { /* non-JSON */ } }
  } catch { /* body already consumed / network */ }
  return `${fallback} (${res.status})`;
}

// ─── Time Audit task catalog ────────────────────────────────────────────
// The 8 most universal marketing tasks Brayson's audience burns time on. Each
// row gets a circular icon chip, a label, a tagline, and a stepper. Tuned so
// reasonable defaults land an owner around ~17 hrs/wk reclaimable.
type TaskDef = {
  id: string;
  label: string;
  tagline: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  defaultHrs: number;
};
const TASKS: TaskDef[] = [
  { id: 'content',    label: 'Writing content',          tagline: 'Posts, newsletters, captions',     icon: PenLine,        defaultHrs: 6 },
  { id: 'dms',        label: 'Replying to DMs',          tagline: 'Inbox + comment triage',           icon: MessageCircle,  defaultHrs: 3 },
  { id: 'scheduling', label: 'Scheduling + posting',     tagline: 'Cross-platform queueing',          icon: CalendarClock,  defaultHrs: 2 },
  { id: 'leads',      label: 'Finding leads',            tagline: 'Prospect research + lists',        icon: Search,         defaultHrs: 4 },
  { id: 'moderation', label: 'Comment moderation',       tagline: 'Spam, trolls, FAQs',               icon: ShieldCheck,    defaultHrs: 2 },
  { id: 'video',      label: 'Video scripting',          tagline: 'Hooks, beats, callbacks',          icon: Video,          defaultHrs: 3 },
  { id: 'thumbnails', label: 'Thumbnail / creative',     tagline: 'Variants + A/B testing',           icon: ImageIcon,      defaultHrs: 2 },
  { id: 'reporting',  label: 'Performance reporting',    tagline: 'Weekly recap + insights',          icon: BarChart3,      defaultHrs: 1 },
];

// ─── Count-up hook ──────────────────────────────────────────────────────
// Animates a numeric value toward `target` over ~360ms with the design
// system's `--ease-out` curve. Respects prefers-reduced-motion.
function useCountUp(target: number, durationMs = 360): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const from = fromRef.current;
    const start = performance.now();
    // ease-out cubic — mirrors --ease-out personality (fast in, soft settle).
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      // Reduced motion → snap to the target on the first frame (no animation).
      // All setState happens inside rAF (never synchronously in the effect body).
      const t = reduced ? 1 : Math.min(1, (now - start) / durationMs);
      const v = from + (target - from) * ease(t);
      setValue(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, durationMs]);

  return value;
}

// ─── Stepper ────────────────────────────────────────────────────────────
// Hours-per-week control: − / [number] / +. Clamped 0–40. Number input is
// editable directly for keyboard users; the buttons are for touch + speed.
function HoursStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.max(0, Math.min(40, Math.round(n)));
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-[var(--surface-1)] p-1">
      <button
        type="button"
        aria-label="Decrease hours"
        onClick={() => onChange(clamp(value - 1))}
        className="h-7 w-7 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-[var(--surface-2)] active:scale-95 transition-[background-color,color,transform] duration-[120ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={40}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        className="!min-h-0 !p-0 w-10 text-center text-sm font-semibold tabular-nums bg-transparent !border-0 focus:!shadow-none"
        style={{ MozAppearance: 'textfield' }}
      />
      <button
        type="button"
        aria-label="Increase hours"
        onClick={() => onChange(clamp(value + 1))}
        className="h-7 w-7 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-[var(--surface-2)] active:scale-95 transition-[background-color,color,transform] duration-[120ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

// ─── Big animated number ────────────────────────────────────────────────
function StatNumber({ value, prefix = '', suffix = '', decimals = 0 }: { value: number; prefix?: string; suffix?: string; decimals?: number }) {
  // Guard against a non-finite input (broken field entry) reaching the animator —
  // otherwise the count-up would render a literal "NaN".
  const safe = Number.isFinite(value) ? value : 0;
  const v = useCountUp(safe);
  const display = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString();
  return (
    <span className="tabular-nums">
      {prefix}{display}{suffix}
    </span>
  );
}

// Empty ROI summary — the graceful default when the audit is untouched and no
// agent actions have been logged yet (fresh / demo tenants). Rendering from this
// (instead of null) means an API failure never traps the page on a skeleton: we
// show the real UI in its "No ROI data yet" state plus an error banner.
const EMPTY_SUMMARY: RoiSummary = {
  audit: {
    annual_revenue: null,
    annual_profit: null,
    hours_per_week: null,
    admin_percentage: null,
    presets: {},
    updated_at: null,
  },
  hoursSavedAllTime: 0,
  hoursSavedThisMonth: 0,
  valueReclaimed: 0,
  oldDollarPerHour: null,
  newDollarPerHour: null,
  projectedAnnualValue: null,
  byAgent: [],
  byMonth: [],
  hasActuals: false,
};

export default function RoiPage() {
  const [data, setData] = useState<RoiSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ annual_revenue: '', annual_profit: '', hours_per_week: '', admin_percentage: '' });
  const [presets, setPresets] = useState<Record<string, number>>({});
  const [showPresets, setShowPresets] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Time Audit calculator state ────────────────────────────────────────
  const [hourlyRate, setHourlyRate] = useState<number>(75);
  const [taskHours, setTaskHours] = useState<Record<string, number>>(
    () => Object.fromEntries(TASKS.map((t) => [t.id, t.defaultHrs]))
  );
  // Audit collapses by default so the live ROI tracker is the headline. Open
  // it when you want to recalibrate. Persist the user's preference per browser.
  const [auditOpen, setAuditOpen] = useState<boolean>(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('roi.audit.open');
      if (raw === '1') setAuditOpen(true);
    } catch { /* blocked — fine */ }
  }, []);
  const toggleAudit = () => {
    setAuditOpen((v) => {
      const next = !v;
      try { localStorage.setItem('roi.audit.open', next ? '1' : '0'); } catch { /* blocked */ }
      return next;
    });
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/roi', { cache: 'no-store' });
      // Parse defensively: an error response may be empty or non-JSON (e.g. an
      // infra 500 HTML page). res.json() would throw and mask the real status,
      // so read text first and only JSON.parse when there's a body.
      const raw = await res.text();
      let json: unknown = null;
      if (raw) { try { json = JSON.parse(raw); } catch { /* non-JSON body */ } }
      const body = (json ?? {}) as Partial<RoiSummary> & { error?: string };
      if (!res.ok) throw new Error(body.error || `Failed to load (${res.status})`);

      // Merge onto EMPTY_SUMMARY so a partial/malformed 200 body can never throw
      // on a missing `audit` (or null nested fields) downstream.
      const summary: RoiSummary = {
        ...EMPTY_SUMMARY,
        ...body,
        audit: { ...EMPTY_SUMMARY.audit, ...(body.audit ?? {}) },
        byAgent: Array.isArray(body.byAgent) ? body.byAgent : [],
        byMonth: Array.isArray(body.byMonth) ? body.byMonth : [],
      };
      setData(summary);
      setPresets(summary.audit.presets ?? {});
      setForm({
        annual_revenue: summary.audit.annual_revenue?.toString() ?? '',
        annual_profit: summary.audit.annual_profit?.toString() ?? '',
        hours_per_week: summary.audit.hours_per_week?.toString() ?? '',
        admin_percentage: summary.audit.admin_percentage?.toString() ?? '',
      });
      setError(null);
    } catch (e) {
      // Keep any previously-loaded data on screen; if we never loaded, the page
      // still renders (from EMPTY_SUMMARY below) with the error banner instead
      // of trapping on the skeleton forever.
      setError((e as Error).message || 'Failed to load ROI data');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(t); }, [notice]);

  // Live calc from the Key Audit form (legacy ROI block).
  const profit = Number(form.annual_profit) || 0;
  const hrs = Number(form.hours_per_week) || 0;
  const adminPct = Number(form.admin_percentage) || 0;
  const annualHours = hrs * WEEKS;
  const oldRate = annualHours > 0 && profit > 0 ? profit / annualHours : null;
  const adminHrsWeek = hrs * (adminPct / 100);
  const adminHrsYear = adminHrsWeek * WEEKS;
  const costOfAdmin = oldRate != null ? adminHrsYear * oldRate : null;

  // ── Time Audit derived numbers ────────────────────────────────────────
  const totals = useMemo(() => {
    const hrsWeek = TASKS.reduce((sum, t) => sum + (taskHours[t.id] || 0), 0);
    const dollarsWeek = hrsWeek * hourlyRate;
    const hrsYear = hrsWeek * WEEKS;
    const dollarsYear = dollarsWeek * WEEKS;
    return { hrsWeek, dollarsWeek, hrsYear, dollarsYear };
  }, [taskHours, hourlyRate]);

  // High-load threshold: more than half a day per workday lost → amber accent.
  const isHeavyLoad = totals.hrsWeek >= 20;

  async function saveAudit() {
    setSaving(true);
    try {
      const res = await fetch('/api/roi', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annual_revenue: form.annual_revenue ? Number(form.annual_revenue) : null,
          annual_profit: form.annual_profit ? Number(form.annual_profit) : null,
          hours_per_week: form.hours_per_week ? Number(form.hours_per_week) : null,
          admin_percentage: form.admin_percentage ? Number(form.admin_percentage) : null,
        }),
      });
      if (!res.ok) { setError(await errMsg(res, 'Save failed')); }
      else { setError(null); setNotice('Key Audit saved'); await load(); }
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function savePresets() {
    setSaving(true);
    try {
      const res = await fetch('/api/roi', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presets }) });
      if (!res.ok) { setError(await errMsg(res, 'Save failed')); }
      else { setError(null); setNotice('Presets saved'); await load(); }
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  // Show the skeleton only while the first load is genuinely in flight. Once
  // we've attempted a load (success OR failure) we always render the real UI —
  // with data on success, or EMPTY_SUMMARY + the error banner on failure — so a
  // fetch error can never trap the page on an endless skeleton.
  if (!loaded && !data) return <div className="space-y-4 animate-in"><Skeleton className="h-8 w-48" /><div className="grid grid-cols-1 md:grid-cols-3 gap-3">{[0,1,2].map((i)=><Skeleton key={i} className="h-28 w-full" />)}</div><Skeleton className="h-64 w-full" /></div>;

  const summary = data ?? EMPTY_SUMMARY;
  const maxMonth = Math.max(1, ...summary.byMonth.map((m) => m.hours));

  return (
    <div className="space-y-6 animate-in">
      <Explainer
        id="roi"
        title="What this is"
        what="How much time your AI team has taken off you, and what that is worth."
        when="When you want to know whether this is paying for itself."
        example="Eleven hours of follow-up and admin last month that nobody had to do."
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-h1 flex items-center gap-2"><Timer size={18} className="text-primary" /> ROI · Time Audit</h1>
          <p className="text-xs text-muted-foreground">
            Find out where your week is going — and what an agent could give back.
            <span className={`badge ml-2 ${summary.hasActuals ? 'badge-success' : 'badge-warning'}`}>{summary.hasActuals ? 'actual' : 'projected'}</span>
          </p>
        </div>
      </div>

      {error && <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5"><AlertCircle size={12} /> {error}</div>}
      {notice && <div className="panel p-3 text-xs text-emerald-500 flex items-center gap-1.5"><Check size={12} /> {notice}</div>}

      {/* ═══════════════════════════════════════════════════════════════════
          TIME AUDIT — Interactive calculator (collapsible)
          Closed by default so the live ROI tracker is the headline. The
          summary stays visible on the trigger so the audit isn't hidden info.
          ═══════════════════════════════════════════════════════════════════ */}
      <button
        type="button"
        onClick={toggleAudit}
        aria-expanded={auditOpen}
        className="panel w-full text-left p-4 flex items-center gap-3 group"
        style={{ transition: 'background-color var(--t-popover) var(--ease-out)' }}
      >
        <ChevronDown
          size={16}
          className="text-muted-foreground shrink-0"
          style={{ transform: auditOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform var(--t-popover) var(--ease-out)' }}
        />
        <Sparkles size={14} className="text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-h2">Audit your week</div>
          <p className="text-small">
            {totals.hrsWeek > 0
              ? <>~{totals.hrsWeek.toFixed(totals.hrsWeek < 10 ? 1 : 0)} hrs/wk = <span className="text-foreground font-semibold">${Math.round(totals.dollarsYear).toLocaleString()}</span>/yr you could reclaim. <span className="text-muted-foreground">Tap to recalibrate.</span></>
              : <>Drop in hours per task to see what you could reclaim.</>}
          </p>
        </div>
        {isHeavyLoad && <span className="badge badge-warning text-[10px] shrink-0">heavy load</span>}
      </button>

      {auditOpen && (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* ── LEFT: Task list ──────────────────────────────────────────── */}
        <div className="panel p-5 space-y-5">
          {/* Header with global rate control */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="section-title flex items-center gap-1.5"><Sparkles size={11} className="text-primary" /> Time Audit</div>
              <h2 className="text-h2">Where does your week go?</h2>
              <p className="text-small">Drop in hours per week per task. We&rsquo;ll show you what that&rsquo;s really costing.</p>
            </div>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Your time is worth</span>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-[var(--surface-1)] px-2 py-1.5">
                <DollarSign size={13} className="text-muted-foreground" />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(Math.max(0, Number(e.target.value) || 0))}
                  className="!min-h-0 !p-0 w-16 text-sm font-semibold tabular-nums bg-transparent !border-0 focus:!shadow-none"
                />
                <span className="text-xs text-muted-foreground">/hr</span>
              </div>
            </label>
          </div>

          {/* Task rows */}
          <div className="space-y-2">
            {TASKS.map((t) => {
              const Icon = t.icon;
              const v = taskHours[t.id] ?? 0;
              const share = totals.hrsWeek > 0 ? (v / totals.hrsWeek) * 100 : 0;
              return (
                <div
                  key={t.id}
                  className="group rounded-xl border border-border/70 bg-[var(--surface-1)] p-3 hover:border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] transition-[border-color,background-color] duration-[200ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 grid place-items-center rounded-full shrink-0"
                      style={{
                        background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
                        color: 'var(--primary)',
                        border: '1px solid color-mix(in srgb, var(--primary) 22%, transparent)',
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{t.label}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{t.tagline}</div>
                    </div>
                    <HoursStepper value={v} onChange={(n) => setTaskHours({ ...taskHours, [t.id]: n })} />
                  </div>
                  {/* Share bar — only shows when there's a total to share */}
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-[var(--surface-2)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-[width] duration-[280ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
                        style={{
                          width: `${share}%`,
                          background: 'color-mix(in srgb, var(--primary) 70%, transparent)',
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums w-14 text-right">
                      {share > 0 ? `${share.toFixed(0)}% · $${Math.round(v * hourlyRate).toLocaleString()}` : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: Sticky summary ────────────────────────────────────── */}
        <div className="lg:sticky lg:top-4 self-start space-y-3">
          <div
            className="panel p-5 space-y-4 transition-[box-shadow,border-color] duration-[200ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={
              isHeavyLoad
                ? {
                    borderColor: 'color-mix(in srgb, var(--warning) 45%, var(--border))',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--warning) 18%, transparent), 0 18px 40px -20px color-mix(in srgb, var(--warning) 35%, transparent)',
                  }
                : undefined
            }
          >
            <div className="flex items-center justify-between">
              <div className="section-title">You could reclaim</div>
              {isHeavyLoad && (
                <span className="badge badge-warning text-[10px]">heavy load</span>
              )}
            </div>

            {/* Hero stat — hours per week */}
            <div className="space-y-1">
              <div
                className="text-display tabular-nums leading-none"
                style={{ color: isHeavyLoad ? 'var(--warning)' : 'var(--primary)' }}
              >
                <StatNumber value={totals.hrsWeek} decimals={totals.hrsWeek < 10 ? 1 : 0} suffix=" hrs" />
              </div>
              <div className="text-xs text-muted-foreground">every week</div>
            </div>

            <div className="h-px bg-border/60" />

            {/* Secondary stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-0.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">/ week</div>
                <div className="text-h2 tabular-nums">
                  <StatNumber value={totals.dollarsWeek} prefix="$" />
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">/ year</div>
                <div className="text-h2 tabular-nums">
                  <StatNumber value={totals.hrsYear} suffix=" hrs" />
                </div>
              </div>
              <div className="space-y-0.5 col-span-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">that&rsquo;s</div>
                <div
                  className="text-display tabular-nums leading-none"
                  style={{ color: isHeavyLoad ? 'var(--warning)' : 'var(--primary)' }}
                >
                  <StatNumber value={totals.dollarsYear} prefix="$" />
                </div>
                <div className="text-[11px] text-muted-foreground">left on the table each year</div>
              </div>
            </div>

            {/* CTA */}
            <Link
              href="/agents/squads"
              className="btn btn-primary w-full justify-between !min-h-[40px] !px-4 !text-[13px] group"
              style={{ boxShadow: '0 8px 22px -10px color-mix(in srgb, var(--primary) 60%, transparent)' }}
            >
              <span className="flex items-center gap-2"><Sparkles size={14} /> Run the agent</span>
              <ArrowRight size={14} className="transition-transform duration-[200ms] ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0.5" />
            </Link>
            <p className="text-[11px] text-muted-foreground text-center -mt-1">
              It can do all of this for you.
            </p>
          </div>
        </div>
      </div>

      )}

      {/* ═══════════════════════════════════════════════════════════════════
          ACTUAL ROI — existing tracker (kept, lives below the audit)
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="space-y-1 pt-2">
        <div className="section-title">Live ROI tracker</div>
        <p className="text-small">What your agents have actually given back so far.</p>
      </div>

      {/* Designed empty state — a fresh/demo tenant has no logged actions yet, so
          the hero stats below are all zeros/dashes. Say so plainly instead of
          leaving the owner staring at an unexplained row of blanks. */}
      {!summary.hasActuals && (
        <div className="panel p-4 flex items-start gap-2.5 text-xs text-muted-foreground">
          <Sparkles size={14} className="text-primary shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="text-foreground font-medium">No ROI data yet</div>
            <p>
              This connects automatically as your agents complete work. Every action they
              take logs the time it saved — the numbers below fill in from there.
              {summary.audit.annual_profit == null && summary.audit.hours_per_week == null && (
                <> Set your <span className="text-foreground">Key Audit</span> below to value each hour reclaimed.</>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Hero stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="panel p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Timer size={12} /> Hours saved</div>
          <div className="text-2xl font-semibold tabular-nums">{fmtHrs(summary.hoursSavedAllTime)}</div>
          <div className="text-[11px] text-muted-foreground">{fmtHrs(summary.hoursSavedThisMonth)} this month</div>
        </div>
        <div className="panel p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><DollarSign size={12} /> Value reclaimed</div>
          <div className="text-2xl font-semibold tabular-nums">{fmtUsd(summary.valueReclaimed)}</div>
          <div className="text-[11px] text-muted-foreground">projected annual {fmtUsd(summary.projectedAnnualValue)}</div>
        </div>
        <div className="panel p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><TrendingUp size={12} /> Your $/hour</div>
          <div className="text-2xl font-semibold flex items-baseline gap-2 tabular-nums">
            {fmtUsd(summary.oldDollarPerHour)}
            {summary.newDollarPerHour != null && summary.oldDollarPerHour != null && summary.newDollarPerHour > summary.oldDollarPerHour && (
              <span className="text-sm text-emerald-500">→ {fmtUsd(summary.newDollarPerHour)}</span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">old → projected new</div>
        </div>
      </div>

      {/* Key Audit */}
      <div className="panel p-4 space-y-3">
        <div className="section-title">Key Audit</div>
        <p className="text-xs text-muted-foreground">Set these once. They define your dollar-per-hour, which values every hour the agents give back.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">Annual revenue ($)</span>
            <input className={INPUT} inputMode="numeric" value={form.annual_revenue} onChange={(e) => setForm({ ...form, annual_revenue: e.target.value })} placeholder="500000" /></label>
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">Annual profit ($)</span>
            <input className={INPUT} inputMode="numeric" value={form.annual_profit} onChange={(e) => setForm({ ...form, annual_profit: e.target.value })} placeholder="150000" /></label>
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">Hours/week (owner)</span>
            <input className={INPUT} inputMode="numeric" value={form.hours_per_week} onChange={(e) => setForm({ ...form, hours_per_week: e.target.value })} placeholder="55" /></label>
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">% on admin/ops</span>
            <input className={INPUT} inputMode="numeric" value={form.admin_percentage} onChange={(e) => setForm({ ...form, admin_percentage: e.target.value })} placeholder="40" /></label>
        </div>
        {oldRate != null && (
          <div className="text-xs bg-[var(--surface-2)] rounded border border-border/60 p-3 space-y-1 font-mono">
            <div>Your time: <b>{fmtUsd(oldRate)}/hr</b> &nbsp;(profit ÷ {annualHours.toLocaleString()} hrs/yr)</div>
            <div>Admin drag: <b>{adminHrsWeek.toFixed(1)} hrs/wk</b> = {Math.round(adminHrsYear).toLocaleString()} hrs/yr {costOfAdmin != null && <>· worth <b>{fmtUsd(costOfAdmin)}/yr</b> trapped in admin</>}</div>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={saveAudit} disabled={saving} className="btn btn-primary btn-sm"><Save size={12} /> Save audit</button>
          <button onClick={() => setShowPresets((s) => !s)} className="btn btn-ghost btn-sm"><SlidersHorizontal size={12} /> {showPresets ? 'Hide' : 'Edit'} time-per-task presets</button>
        </div>
      </div>

      {/* Presets editor */}
      {showPresets && (
        <div className="panel p-4 space-y-3">
          <div className="section-title">Minutes saved per task type</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(presets).map(([k, v]) => (
              <label key={k} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{k.replace(/_/g, ' ')}</span>
                <input className="px-2 py-1 rounded border border-border bg-background text-sm w-20 text-right" inputMode="numeric"
                  value={v} onChange={(e) => setPresets({ ...presets, [k]: Number(e.target.value) || 0 })} />
              </label>
            ))}
          </div>
          <button onClick={savePresets} disabled={saving} className="btn btn-primary btn-sm"><Save size={12} /> Save presets</button>
        </div>
      )}

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4 space-y-2">
          <div className="section-title">By agent</div>
          {summary.byAgent.length === 0 ? (
            <div className="text-xs text-muted-foreground">No agent activity logged yet. As agents complete tasks, their time savings appear here.</div>
          ) : summary.byAgent.map((a) => (
            <div key={a.agent_id ?? 'unknown'} className="flex items-center justify-between text-xs">
              <span className="font-mono">{a.agent_id ?? 'unknown'}</span>
              <span className="text-muted-foreground tabular-nums">{fmtHrs(a.hours)} · {fmtUsd(a.value)}</span>
            </div>
          ))}
        </div>
        <div className="panel p-4 space-y-2">
          <div className="section-title">Monthly trend</div>
          {summary.byMonth.length === 0 ? (
            <div className="text-xs text-muted-foreground">No history yet.</div>
          ) : summary.byMonth.map((m) => (
            <div key={m.month} className="space-y-0.5">
              <div className="flex justify-between text-[11px] text-muted-foreground"><span>{m.month}</span><span className="tabular-nums">{fmtHrs(m.hours)}</span></div>
              <div className="h-2 rounded bg-[var(--surface-2)] overflow-hidden">
                <div className="h-full bg-primary/70" style={{ width: `${Math.min(100, (m.hours / maxMonth) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
