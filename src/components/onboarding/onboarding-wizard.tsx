'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ConnectPanel from '@/components/connections/connect-panel';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  Check,
  Eye,
  Flag,
  Lightbulb,
  Loader2,
  ListChecks,
  Mail,
  Palette,
  PartyPopper,
  Plug,
  Rocket,
  Sparkles,
  Target,
  Timer,
  UserCircle2,
  UserPlus,
  Users2,
  Zap,
} from 'lucide-react';

const INPUT = 'px-3 py-2 rounded-lg border border-border bg-background text-sm w-full';

// ─── Types ──────────────────────────────────────────────────────────────────
type Role = 'owner' | 'assistant' | 'client';
type Autonomy = 'observe' | 'propose' | 'act_notify' | 'full_auto';
type AgencySize = '1' | '2-5' | '6+';
type NotifyChannel = 'in_app' | 'imessage' | 'email';

interface BusinessProfile {
  businessName: string;
  industry: string;
  teamSize: string;
  website: string;
  linkedin: string;
  instagram: string;
}

interface BrandData {
  primaryColor: string;
  logoUrl: string;
}

interface NorthStar {
  title: string;
  success: string;
  due: string;
}

interface PriorityRow {
  title: string;
  success: string;
}

interface OwnerPrefs {
  notifyChannel: NotifyChannel;
  timezone: string;
  quietStart: string;
  quietEnd: string;
}

interface CronExec {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
}

// What /api/invite reported back: emailed ✓, or a link to share manually when
// no email provider is configured, or an error to surface.
interface InviteResult {
  emailed: boolean;
  link: string | null;
  error: string | null;
}

interface WizardData {
  role: Role | null;
  agencySize: AgencySize | null;
  autonomy: Autonomy;
  business: BusinessProfile;
  brand: BrandData;
  northStar: NorthStar;
  priorities: PriorityRow[];
  cadenceEdits: Record<string, boolean>; // id -> enabled
  prefs: OwnerPrefs;
  inviteEmail: string;
  knowledgeSeed: string;
  audit: {
    annual_revenue: string;
    annual_profit: string;
    hours_per_week: string;
    admin_percentage: string;
  };
}

const INDUSTRIES = [
  'Real Estate',
  'Marketing',
  'E-Commerce',
  'Finance',
  'Professional Services',
  'Other',
];

const TEAM_SIZES = ['1-5', '5-20', '20-100', '100+'];

const AGENCY_SIZES: Array<{ id: AgencySize; label: string; desc: string }> = [
  { id: '1', label: 'Just me', desc: 'Solo operator — every minute counts.' },
  { id: '2-5', label: '2–5 people', desc: 'Small team, lean tools, fast cycles.' },
  { id: '6+', label: '6+ people', desc: 'Established team with multiple swimlanes.' },
];

const AUTONOMY_STOPS: Array<{ id: Autonomy; label: string; desc: string }> = [
  { id: 'observe', label: 'Observe', desc: 'Watches and learns. Never acts or messages.' },
  { id: 'propose', label: 'Propose', desc: 'Drafts everything for your one-tap approval.' },
  { id: 'act_notify', label: 'Act + Notify', desc: 'Acts on routine work, then tells you what it did.' },
  { id: 'full_auto', label: 'Full Auto', desc: 'Runs the playbook end-to-end. Hands off.' },
];

const NOTIFY_CHANNELS: Array<{ id: NotifyChannel; label: string; desc: string }> = [
  { id: 'in_app', label: 'In-app only', desc: 'Quiet by default. See it when you log in.' },
  { id: 'imessage', label: 'iMessage', desc: 'Pings you on iMessage (LoopMessage).' },
  { id: 'email', label: 'Email', desc: 'Daily/weekly digests in your inbox.' },
];

// 6-step activation path. Everything that doesn't change the FIRST draft an
// agent produces lives elsewhere (brand → /settings, prefs → /settings, invite
// → /settings, audit → /roi, cadence → discovered when execs are seeded). The
// goal is sign-in → first mission firing in <90 seconds.
//
// We keep the save handlers for the dropped steps in place so /settings can
// reuse them when the user customises later.
const STEPS = [
  { key: 'welcome',   kicker: 'Step 1 · Welcome',         headline: 'Welcome to your Command Centre.',                  icon: Rocket    },
  { key: 'profile',   kicker: 'Step 2 · Your agency',     headline: 'Tell us who you are.',                             icon: Building2 },
  { key: 'stack',     kicker: 'Step 3 · Connect a channel', headline: 'Plug in your channels.',                         icon: Plug      },
  { key: 'autonomy',  kicker: 'Step 4 · Autonomy',        headline: 'How much should it run on its own?',               icon: Zap       },
  { key: 'northstar', kicker: 'Step 5 · North Star',      headline: "What's the one outcome that matters?",             icon: Target    },
  { key: 'seed',      kicker: 'Step 6 · Voice & context', headline: 'Tell us about the agency, in plain English.',      icon: Sparkles  },
  { key: 'done',      kicker: 'All set',                  headline: 'Your command centre is ready.',                    icon: PartyPopper },
] as const;

const WEEKS = 52;
const fmtUsd = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);

// Browser-detected timezone with a sensible fallback. Brayson is in Toronto, but
// we honour whatever the user's browser reports if available.
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';
  } catch {
    return 'America/Toronto';
  }
}

// `onDone` lets the wizard run embedded (e.g. as the overview-page gate): instead of
// navigating, it tells the host to hide. Falls back to router navigation as a route.
export function OnboardingWizard({ onDone }: { onDone?: () => void } = {}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WizardData>({
    role: null,
    agencySize: null,
    autonomy: 'propose',
    business: { businessName: '', industry: '', teamSize: '', website: '', linkedin: '', instagram: '' },
    brand: { primaryColor: '#10D982', logoUrl: '' },
    northStar: { title: '', success: '', due: '' },
    priorities: [
      { title: '', success: '' },
      { title: '', success: '' },
      { title: '', success: '' },
    ],
    cadenceEdits: {},
    prefs: { notifyChannel: 'in_app', timezone: detectTimezone(), quietStart: '22:00', quietEnd: '07:00' },
    inviteEmail: '',
    knowledgeSeed: '',
    audit: { annual_revenue: '', annual_profit: '', hours_per_week: '', admin_percentage: '' },
  });

  // C-suite cadence rows — loaded lazily when we reach the cadence step. We
  // intentionally don't block earlier steps on this fetch.
  const [csuite, setCsuite] = useState<CronExec[] | null>(null);
  const [csuiteLoaded, setCsuiteLoaded] = useState(false);

  // Outcome of the teammate invite (legacy step, kept wired for /settings reuse):
  // emailed ✓, or a copyable link when no email provider is configured.
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);

  // Prefill from the workspace + skip the wizard entirely if already onboarded.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/onboarding', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        if (json.onboarding_complete) {
          if (onDone) onDone(); else router.replace('/');
          return;
        }
        const bp = json.business_profile;
        if (bp && typeof bp === 'object') {
          setData((d) => ({
            ...d,
            role: bp.role ?? d.role,
            agencySize: (bp.agency_size as AgencySize) ?? d.agencySize,
            autonomy: (bp.autonomy as Autonomy) ?? d.autonomy,
            business: {
              businessName: bp.businessName ?? d.business.businessName,
              industry: bp.industry ?? d.business.industry,
              teamSize: bp.teamSize ?? d.business.teamSize,
              website: bp.website ?? d.business.website,
              linkedin: bp.linkedin ?? d.business.linkedin,
              instagram: bp.instagram ?? d.business.instagram,
            },
            brand: {
              primaryColor: bp.brand?.primaryColor ?? d.brand.primaryColor,
              logoUrl: bp.brand?.logoUrl ?? d.brand.logoUrl,
            },
            prefs: {
              notifyChannel: (bp.prefs?.notifyChannel as NotifyChannel) ?? d.prefs.notifyChannel,
              timezone: bp.prefs?.timezone ?? d.prefs.timezone,
              quietStart: bp.prefs?.quietStart ?? d.prefs.quietStart,
              quietEnd: bp.prefs?.quietEnd ?? d.prefs.quietEnd,
            },
          }));
        }
      } catch {
        /* prefill is best-effort; ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, onDone]);

  const isLast = step === STEPS.length - 1;
  const meta = STEPS[step];

  // Live $/hr preview for the audit step.
  const dollarPerHour = useMemo(() => {
    const profit = Number(data.audit.annual_profit) || 0;
    const hrs = Number(data.audit.hours_per_week) || 0;
    const annualHours = hrs * WEEKS;
    return annualHours > 0 && profit > 0 ? profit / annualHours : null;
  }, [data.audit.annual_profit, data.audit.hours_per_week]);

  // Required-field gating per step. Only Welcome (role) + Profile (name/industry/team)
  // gate Continue; everything else is skippable so the wizard never traps the user.
  const canContinue = useMemo(() => {
    switch (meta.key) {
      case 'welcome':
        return data.role != null; // agencySize stays optional
      case 'profile':
        return data.business.businessName.trim().length > 0 && data.business.industry !== '' && data.business.teamSize !== '';
      default:
        return true;
    }
  }, [meta.key, data]);

  // C-suite cadence loader was removed when the cadence step was dropped from
  // the trimmed wizard. /settings will load this fresh when it surfaces the
  // cron toggle UI there.

  // ── Per-step save helpers ──────────────────────────────────────────────────
  // We save on "Continue" so the user never loses typed text by clicking Back
  // and returning. All saves are best-effort: a single network hiccup doesn't
  // trap the user mid-flow.

  const saveAudit = useCallback(async () => {
    const a = data.audit;
    if (!a.annual_revenue && !a.annual_profit && !a.hours_per_week && !a.admin_percentage) return;
    try {
      await fetch('/api/roi', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annual_revenue: a.annual_revenue ? Number(a.annual_revenue) : null,
          annual_profit: a.annual_profit ? Number(a.annual_profit) : null,
          hours_per_week: a.hours_per_week ? Number(a.hours_per_week) : null,
          admin_percentage: a.admin_percentage ? Number(a.admin_percentage) : null,
        }),
      });
    } catch { /* non-blocking */ }
  }, [data.audit]);

  // Push the chosen autonomy level into tenants.business_profile via the real
  // /api/autonomy endpoint (PUT, not POST). Final POST /api/onboarding will also
  // include it for belt-and-suspenders.
  const saveAutonomy = useCallback(async () => {
    try {
      await fetch('/api/autonomy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: data.autonomy }),
      });
    } catch { /* non-blocking */ }
  }, [data.autonomy]);

  const saveNorthStar = useCallback(async () => {
    const g = data.northStar;
    if (!g.title.trim()) return;
    try {
      await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          title: g.title.trim(),
          success: g.success.trim() || g.title.trim(),
          due: g.due || undefined,
          // TODO(api): goals lib currently only persists metadata.owner. Extend
          // createGoal to accept arbitrary metadata so this flag survives the
          // round-trip; the Top Priorities strip on Overview filters on it.
          is_north_star: true,
        }),
      });
    } catch { /* non-blocking */ }
  }, [data.northStar]);

  const savePriorities = useCallback(async () => {
    const valid = data.priorities.filter((p) => p.title.trim().length > 0);
    if (valid.length === 0) return;
    try {
      await Promise.all(
        valid.map((p) =>
          fetch('/api/goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create',
              title: p.title.trim(),
              success: p.success.trim() || p.title.trim(),
            }),
          }),
        ),
      );
    } catch { /* non-blocking */ }
  }, [data.priorities]);

  const saveCadence = useCallback(async () => {
    if (!csuite) return;
    // Only PATCH rows whose enabled flag the user actually changed.
    const diffs = csuite.filter((r) => data.cadenceEdits[r.id] !== r.enabled);
    if (diffs.length === 0) return;
    try {
      await Promise.all(
        diffs.map((r) =>
          fetch('/api/cron/jobs', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job: { id: r.id, enabled: data.cadenceEdits[r.id] } }),
          }),
        ),
      );
    } catch { /* non-blocking */ }
  }, [csuite, data.cadenceEdits]);

  const saveInvite = useCallback(async () => {
    const email = data.inviteEmail.trim();
    if (!email) return;
    try {
      // /api/invite is real now: it creates the user + membership and tries to
      // email the sign-in link. We keep the result so InviteStep can say
      // honestly whether the email went out or the link must be shared by hand.
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteResult({ emailed: false, link: null, error: j.error || 'Invite failed' });
        return;
      }
      setInviteResult({ emailed: !!j.emailed, link: j.inviteLink ?? null, error: null });
    } catch { /* non-blocking — the wizard never gates on the invite */ }
  }, [data.inviteEmail]);

  // Drops the free-form seed into a KB document named "Agency profile" via the
  // existing documents API (createDocument → appendKnowledgeSection-style entry
  // shape). The content-writer/outreach-sender then have day-one voice context.
  const saveKnowledgeSeed = useCallback(async () => {
    const seed = data.knowledgeSeed.trim();
    if (!seed) return;
    try {
      await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Agency profile',
          type: 'note',
          status: 'wiki',
          content: `# Agency profile\n\n_Seeded during onboarding. Edit anytime._\n\n${seed}\n`,
        }),
      });
    } catch { /* non-blocking */ }
  }, [data.knowledgeSeed]);

  const goNext = useCallback(async () => {
    setError(null);
    // Side-effect for the step we're leaving. Trimmed to the 6 active steps;
    // the legacy save fns (priorities/cadence/invite/audit) stay defined above
    // so /settings can reuse them later.
    switch (meta.key) {
      case 'autonomy':  await saveAutonomy(); break;
      case 'northstar': await saveNorthStar(); break;
      case 'seed':      await saveKnowledgeSeed(); break;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, [meta.key, saveAutonomy, saveNorthStar, saveKnowledgeSeed]);

  const goBack = useCallback(() => {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  // Final submit → persist the full profile (role, autonomy, brand, prefs, agency
  // size, business profile) onto tenants.business_profile, mark onboarded, enter.
  const finish = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: data.role,
          autonomy: data.autonomy,
          // TODO(schema): if/when a dedicated `tenants.brand` jsonb column is
          // added, split brand out of business_profile and write there instead.
          // For now everything piggybacks on the existing business_profile jsonb.
          businessProfile: {
            ...data.business,
            agency_size: data.agencySize,
            brand: data.brand,
            prefs: data.prefs,
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Could not save your setup');
      }
      if (onDone) onDone(); else router.push('/');
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }, [data, router, onDone]);

  const progress = (step / (STEPS.length - 1)) * 100;
  const HeroIcon = meta.icon;

  // Which steps may show a "Skip for now" affordance. Everything between
  // profile and audit is skippable — none of them block the user.
  const skippableKeys = new Set(['stack', 'autonomy', 'northstar', 'seed']);
  const showSkip = skippableKeys.has(meta.key);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#0a0a0f] text-foreground dark">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(900px circle at 12% -5%, rgba(16,217,130,0.10), transparent 45%), radial-gradient(1100px circle at 105% 110%, rgba(245,166,35,0.06), transparent 50%)',
        }}
      />

      <div className="absolute inset-x-0 top-0 z-20 h-1 bg-white/5">
        <div
          className="h-full bg-[var(--primary)] transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%`, boxShadow: '0 0 12px rgba(16,217,130,0.6)' }}
        />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col md:flex-row">
        <aside className="relative hidden w-2/5 shrink-0 flex-col justify-between overflow-hidden border-r border-border p-10 md:flex">
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(16,217,130,0.22), transparent 60%)', filter: 'blur(40px)' }}
          />
          <div className="relative flex items-center gap-2 text-sm font-semibold">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)]">
              <Sparkles size={15} />
            </span>
            KeyPlayers
          </div>

          <div className="relative space-y-4">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400">
              <HeroIcon size={13} /> {meta.kicker}
            </div>
            <h2 className="max-w-[14ch] text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
              {meta.headline}
            </h2>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              Your always-on command centre — research, drafting, outreach and reporting, run by a squad of agents you supervise.
            </p>
          </div>

          {/* Step dots scale with the step count automatically. */}
          <div className="relative flex flex-wrap items-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 26 : 6,
                  background: i <= step ? 'var(--primary)' : 'rgba(255,255,255,0.16)',
                }}
              />
            ))}
          </div>
        </aside>

        <main className="relative flex flex-1 items-center justify-center overflow-y-auto p-6 md:p-10">
          <div className="w-full max-w-xl">
            <div key={step} className="animate-slide-in">
              <div className="panel p-6 md:p-8">
                <div className="mb-4 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400 md:hidden">
                  <HeroIcon size={13} /> {meta.kicker}
                </div>

                {meta.key === 'welcome' && (
                  <WelcomeStep
                    role={data.role}
                    agencySize={data.agencySize}
                    onPickRole={(role) => setData((d) => ({ ...d, role }))}
                    onPickSize={(agencySize) => setData((d) => ({ ...d, agencySize }))}
                  />
                )}

                {meta.key === 'profile' && (
                  <ProfileStep value={data.business} onChange={(business) => setData((d) => ({ ...d, business }))} />
                )}

                {meta.key === 'stack' && <StackStep />}

                {meta.key === 'autonomy' && (
                  <AutonomyStep value={data.autonomy} onChange={(autonomy) => setData((d) => ({ ...d, autonomy }))} />
                )}

                {meta.key === 'northstar' && (
                  <NorthStarStep value={data.northStar} onChange={(northStar) => setData((d) => ({ ...d, northStar }))} />
                )}

                {meta.key === 'seed' && (
                  <SeedStep value={data.knowledgeSeed} onChange={(knowledgeSeed) => setData((d) => ({ ...d, knowledgeSeed }))} />
                )}

                {meta.key === 'done' && <DoneStep role={data.role} />}

                {error && (
                  <div className="mt-5 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">
                    {error}
                  </div>
                )}

                <div className="mt-8 flex items-center justify-between gap-3">
                  <button
                    onClick={goBack}
                    disabled={step === 0 || submitting}
                    className="btn btn-ghost btn-sm"
                    style={step === 0 ? { visibility: 'hidden' } : undefined}
                  >
                    <ArrowLeft size={13} /> Back
                  </button>

                  <div className="flex items-center gap-2">
                    {showSkip && !isLast && (
                      <button onClick={goNext} className="btn btn-ghost btn-sm" disabled={submitting}>
                        Skip for now
                      </button>
                    )}
                    {!isLast ? (
                      <button onClick={goNext} disabled={!canContinue || submitting} className="btn btn-primary btn-sm">
                        Continue <ArrowRight size={13} />
                      </button>
                    ) : (
                      <button onClick={finish} disabled={submitting} className="btn btn-primary btn-sm">
                        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />} Enter the dashboard
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Step 1: Welcome, role & agency size ──────────────────────────────────────
function WelcomeStep({
  role, agencySize, onPickRole, onPickSize,
}: {
  role: Role | null; agencySize: AgencySize | null;
  onPickRole: (r: Role) => void; onPickSize: (s: AgencySize) => void;
}) {
  const options: Array<{ id: Role; label: string; desc: string }> = [
    { id: 'owner', label: "I'm the business owner", desc: 'You run the show. The centre works for you.' },
    { id: 'assistant', label: "I'm the assistant (VA)", desc: 'You operate it on the owner’s behalf.' },
    { id: 'client', label: 'Setting this up for a client', desc: 'Agency / consultant configuring for someone else.' },
  ];
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Welcome to your Command Centre.</h1>
      <p className="text-sm text-muted-foreground">First, who are you here? This tailors how we talk to you.</p>
      <div className="space-y-2.5">
        {options.map((o) => {
          const active = role === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPickRole(o.id)}
              className="flex w-full items-center gap-3 rounded-xl border bg-[var(--surface-2)] p-3.5 text-left transition-all"
              style={{
                borderColor: active ? 'var(--primary)' : 'var(--border)',
                boxShadow: active ? '0 0 0 1px var(--primary), 0 0 18px rgba(16,217,130,0.15)' : undefined,
              }}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                style={{
                  borderColor: active ? 'var(--primary)' : 'var(--border)',
                  background: active ? 'var(--primary)' : 'transparent',
                }}
              >
                {active && <Check size={12} className="text-[var(--primary-foreground)]" />}
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <UserCircle2 size={15} className="text-muted-foreground" /> {o.label}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{o.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2 pt-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How big is the team?</div>
        <div className="grid grid-cols-3 gap-2">
          {AGENCY_SIZES.map((o) => {
            const active = agencySize === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onPickSize(o.id)}
                className="rounded-xl border bg-[var(--surface-2)] p-3 text-left transition-all"
                style={{
                  borderColor: active ? 'var(--primary)' : 'var(--border)',
                  boxShadow: active ? '0 0 0 1px var(--primary)' : undefined,
                }}
              >
                <div className="text-sm font-medium">{o.label}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{o.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Business profile ─────────────────────────────────────────────────
function ProfileStep({ value, onChange }: { value: BusinessProfile; onChange: (v: BusinessProfile) => void }) {
  const set = (patch: Partial<BusinessProfile>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tell us about the business.</h1>
      <p className="text-xs text-muted-foreground">We&apos;ll use these to build your business brain.</p>

      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Business name *</span>
        <input className={INPUT} value={value.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder="KeyPlayers HQ" />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Industry *</span>
          <select className={INPUT} value={value.industry} onChange={(e) => set({ industry: e.target.value })}>
            <option value="">Select…</option>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Team size *</span>
          <select className={INPUT} value={value.teamSize} onChange={(e) => set({ teamSize: e.target.value })}>
            <option value="">Select…</option>
            {TEAM_SIZES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Website URL</span>
        <input className={INPUT} value={value.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://keyplayershq.com" />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">LinkedIn (optional)</span>
          <input className={INPUT} value={value.linkedin} onChange={(e) => set({ linkedin: e.target.value })} placeholder="company/keyplayers" />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Instagram (optional)</span>
          <input className={INPUT} value={value.instagram} onChange={(e) => set({ instagram: e.target.value })} placeholder="@keyplayers" />
        </label>
      </div>
    </div>
  );
}

// ─── Step 3: Brand basics ─────────────────────────────────────────────────────
function BrandStep({ value, onChange }: { value: BrandData; onChange: (v: BrandData) => void }) {
  const set = (patch: Partial<BrandData>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Make it feel like yours.</h1>
      <p className="text-xs text-muted-foreground">
        We&apos;ll use this to theme the dashboard and prime the content-writer&apos;s voice. You can change it anytime.
      </p>

      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Primary brand color</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="h-10 w-12 rounded-lg border border-border bg-background"
            value={value.primaryColor}
            onChange={(e) => set({ primaryColor: e.target.value })}
          />
          <input className={INPUT} value={value.primaryColor} onChange={(e) => set({ primaryColor: e.target.value })} placeholder="#10D982" />
        </div>
      </label>

      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Logo URL (optional)</span>
        <input className={INPUT} value={value.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} placeholder="https://…/logo.svg" />
        <span className="block text-[11px] text-muted-foreground">
          Logo upload is coming soon. Paste a hosted URL for now (Cloudinary, S3, your CDN).
        </span>
      </label>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-[var(--surface-2)] p-3">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: value.primaryColor, boxShadow: `0 0 16px ${value.primaryColor}55` }}
        >
          <Sparkles size={14} className="text-black/70" />
        </span>
        <div className="text-xs">
          <div className="font-medium">Preview</div>
          <div className="text-muted-foreground">This colour will accent CTAs across the app.</div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Connect your stack ───────────────────────────────────────────────
function StackStep() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Connect your stack.</h1>
      <p className="text-xs text-muted-foreground">
        Link the channels your agents should watch and post to. You can connect more anytime from Settings → Connections.
      </p>
      <ConnectPanel />
    </div>
  );
}

// ─── Step 5: Autonomy ─────────────────────────────────────────────────────────
function AutonomyStep({ value, onChange }: { value: Autonomy; onChange: (v: Autonomy) => void }) {
  const activeIdx = AUTONOMY_STOPS.findIndex((s) => s.id === value);
  const active = AUTONOMY_STOPS[activeIdx];
  const icons = [Eye, Lightbulb, Zap, Rocket];
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">How much should it run on its own?</h1>
      <p className="text-xs text-muted-foreground">You can change this anytime. We recommend starting at Propose.</p>

      <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-border bg-[var(--surface-2)] p-1.5">
        {AUTONOMY_STOPS.map((s, i) => {
          const Icon = icons[i];
          const isActive = s.id === value;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(s.id)}
              className="flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center transition-all"
              style={{
                background: isActive ? 'var(--primary)' : 'transparent',
                color: isActive ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                boxShadow: isActive ? '0 0 16px rgba(16,217,130,0.35)' : undefined,
              }}
            >
              <Icon size={16} />
              <span className="text-[11px] font-semibold leading-tight">{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1">
        {AUTONOMY_STOPS.map((s, i) => (
          <span
            key={s.id}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: i <= activeIdx ? 'var(--primary)' : 'rgba(255,255,255,0.12)' }}
          />
        ))}
      </div>

      <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4">
        <div className="text-sm font-semibold text-[var(--primary)]">{active.label}</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{active.desc}</p>
      </div>
    </div>
  );
}

// ─── Step 6: North Star goal ──────────────────────────────────────────────────
function NorthStarStep({ value, onChange }: { value: NorthStar; onChange: (v: NorthStar) => void }) {
  const set = (patch: Partial<NorthStar>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Set your North Star.</h1>
      <p className="text-xs text-muted-foreground">
        One outcome to point every agent at. Skippable — but defining it here teaches the squad what &ldquo;winning&rdquo; looks like.
      </p>

      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">North Star title</span>
        <input
          className={INPUT}
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="What's the one outcome you want your AI team to drive this quarter?"
        />
      </label>

      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">How will you know it&apos;s won?</span>
        <textarea
          className={`${INPUT} min-h-[80px]`}
          value={value.success}
          onChange={(e) => set({ success: e.target.value })}
          placeholder="e.g. 50 booked discovery calls from new outbound by Sep 30"
        />
      </label>

      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Target date (optional)</span>
        <input type="date" className={INPUT} value={value.due} onChange={(e) => set({ due: e.target.value })} />
      </label>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-[var(--surface-2)] p-3 text-xs text-muted-foreground">
        <Flag size={14} className="text-[var(--primary)]" />
        This becomes your North Star — pinned to the top of the Overview.
      </div>
    </div>
  );
}

// ─── Step 7: Top priorities (3 supporting goals) ──────────────────────────────
function PrioritiesStep({ value, onChange }: { value: PriorityRow[]; onChange: (v: PriorityRow[]) => void }) {
  const setRow = (i: number, patch: Partial<PriorityRow>) => {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Pick three top priorities.</h1>
      <p className="text-xs text-muted-foreground">
        These light up the Top Priorities strip on the Overview. Leave any blank — only filled rows are saved.
      </p>

      <div className="space-y-3">
        {value.map((p, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border bg-[var(--surface-2)] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Priority {i + 1}</div>
            <input
              className={INPUT}
              value={p.title}
              onChange={(e) => setRow(i, { title: e.target.value })}
              placeholder="e.g. Ship the LinkedIn outbound engine"
            />
            <input
              className={INPUT}
              value={p.success}
              onChange={(e) => setRow(i, { success: e.target.value })}
              placeholder="Definition of done (optional)"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 8: C-suite cadence confirmation ─────────────────────────────────────
function CadenceStep({
  rows, edits, onToggle,
}: {
  rows: CronExec[] | null;
  edits: Record<string, boolean>;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Confirm the C-suite rhythm.</h1>
      <p className="text-xs text-muted-foreground">
        Your five execs run on cron. Toggle off any you don&apos;t want active yet — you can flip them on anytime.
      </p>

      {rows === null ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-[var(--surface-2)] p-4 text-xs text-muted-foreground">
          No executive cron jobs found yet. They&apos;ll appear here after the C-suite is seeded for your tenant.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="bg-[var(--surface-2)] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Executive</th>
                <th className="px-3 py-2 text-left font-medium">Schedule</th>
                <th className="px-3 py-2 text-right font-medium">On</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const enabled = edits[r.id] ?? r.enabled;
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{r.schedule}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onToggle(r.id, !enabled)}
                        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                        style={{ background: enabled ? 'var(--primary)' : 'rgba(255,255,255,0.12)' }}
                        aria-pressed={enabled}
                      >
                        <span
                          className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
                          style={{ transform: enabled ? 'translateX(18px)' : 'translateX(2px)' }}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Step 9: Owner preferences (notify + tz + quiet) ──────────────────────────
function PrefsStep({ value, onChange }: { value: OwnerPrefs; onChange: (v: OwnerPrefs) => void }) {
  const set = (patch: Partial<OwnerPrefs>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">How should we reach you?</h1>
      <p className="text-xs text-muted-foreground">Pick a channel and quiet hours. We respect them everywhere.</p>

      <div className="space-y-2">
        {NOTIFY_CHANNELS.map((c) => {
          const active = value.notifyChannel === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => set({ notifyChannel: c.id })}
              className="flex w-full items-center gap-3 rounded-xl border bg-[var(--surface-2)] p-3 text-left transition-all"
              style={{
                borderColor: active ? 'var(--primary)' : 'var(--border)',
                boxShadow: active ? '0 0 0 1px var(--primary)' : undefined,
              }}
            >
              <Mail size={14} className="text-muted-foreground" />
              <span className="flex-1">
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="block text-[11px] text-muted-foreground">{c.desc}</span>
              </span>
              {active && <Check size={14} className="text-[var(--primary)]" />}
            </button>
          );
        })}
      </div>

      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Timezone</span>
        <input className={INPUT} value={value.timezone} onChange={(e) => set({ timezone: e.target.value })} placeholder="America/Toronto" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Quiet hours start</span>
          <input type="time" className={INPUT} value={value.quietStart} onChange={(e) => set({ quietStart: e.target.value })} />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Quiet hours end</span>
          <input type="time" className={INPUT} value={value.quietEnd} onChange={(e) => set({ quietEnd: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

// ─── Step 10: Invite teammate ─────────────────────────────────────────────────
function InviteStep({ value, onChange, result }: {
  value: string;
  onChange: (v: string) => void;
  result?: InviteResult | null;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Bring someone in?</h1>
      <p className="text-xs text-muted-foreground">
        Invite a teammate by email. They&apos;ll get the same tenant view you do. Totally skippable.
      </p>

      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Teammate email</span>
        <input
          className={INPUT}
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="teammate@youragency.com"
          inputMode="email"
        />
      </label>

      {/* Honest invite outcome: emailed ✓, or hand them the link yourself. */}
      {result && (
        result.error ? (
          <p className="text-xs text-destructive">{result.error}</p>
        ) : result.emailed ? (
          <p className="text-xs text-[var(--success)]">Invite emailed ✓</p>
        ) : result.link ? (
          <div className="space-y-1">
            <input readOnly className={INPUT} value={result.link} onFocus={(e) => e.currentTarget.select()} />
            <p className="text-[11px] text-muted-foreground">
              Email not configured — copy this sign-in link and send it to them yourself.
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Invite recorded, but no email was sent and no link could be generated — re-invite from Settings → Team.
          </p>
        )
      )}

      <div className="flex items-center gap-2 rounded-xl border border-border bg-[var(--surface-2)] p-3 text-xs text-muted-foreground">
        <UserPlus size={14} className="text-[var(--primary)]" />
        You can invite more from Settings → Team anytime.
      </div>
    </div>
  );
}

// ─── Step 11: Knowledge seed → KB doc "Agency profile" ────────────────────────
function SeedStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Give the squad a voice memo.</h1>
      <p className="text-xs text-muted-foreground">
        Three paragraphs: who you serve, what you sell, the voice you want. We&apos;ll save it as
        the &ldquo;Agency profile&rdquo; knowledge doc so every agent — content-writer, outreach-sender —
        has your voice from day one.
      </p>

      <textarea
        className={`${INPUT} min-h-[220px] leading-relaxed`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Who do you serve?\n\nWhat do you sell?\n\nWhat does your voice sound like — playful, blunt, formal, warm?`}
      />

      <div className="text-[11px] text-muted-foreground">
        Pro tip: the more honest you are about your voice, the less editing you&apos;ll do later.
      </div>
    </div>
  );
}

// ─── Step 12: Key Audit ───────────────────────────────────────────────────────
function AuditStep({
  value,
  onChange,
  dollarPerHour,
}: {
  value: WizardData['audit'];
  onChange: (v: WizardData['audit']) => void;
  dollarPerHour: number | null;
}) {
  const set = (patch: Partial<WizardData['audit']>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">What is your time worth?</h1>
      <p className="text-xs text-muted-foreground">
        Set these once. They define your dollar-per-hour, so every hour the agents give back has a real number on it.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Annual revenue ($)</span>
          <input className={INPUT} inputMode="numeric" value={value.annual_revenue} onChange={(e) => set({ annual_revenue: e.target.value })} placeholder="500000" />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Annual profit ($)</span>
          <input className={INPUT} inputMode="numeric" value={value.annual_profit} onChange={(e) => set({ annual_profit: e.target.value })} placeholder="150000" />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Hours / week</span>
          <input className={INPUT} inputMode="numeric" value={value.hours_per_week} onChange={(e) => set({ hours_per_week: e.target.value })} placeholder="55" />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">% on admin</span>
          <input className={INPUT} inputMode="numeric" value={value.admin_percentage} onChange={(e) => set({ admin_percentage: e.target.value })} placeholder="40" />
        </label>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-[var(--surface-2)] p-4">
        <span className="text-xs text-muted-foreground">Your time is worth</span>
        <span className="font-mono text-2xl font-semibold text-[var(--primary)]">
          {dollarPerHour != null ? `${fmtUsd(dollarPerHour)}/hr` : '—'}
        </span>
      </div>
    </div>
  );
}

// ─── Step 13: Done ────────────────────────────────────────────────────────────
function DoneStep({ role }: { role: Role | null }) {
  const who =
    role === 'assistant' ? 'You’re set up to operate it.' : role === 'client' ? 'Your client’s centre is set up.' : 'Everything is wired and ready.';
  return (
    <div className="space-y-5 text-center">
      <div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(16,217,130,0.14)', border: '1px solid rgba(16,217,130,0.35)', boxShadow: '0 0 32px rgba(16,217,130,0.25)' }}
      >
        <PartyPopper size={28} className="text-[var(--primary)]" />
      </div>
      <h1 className="text-2xl font-semibold">Your command centre is ready.</h1>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">
        {who} Your agent squad is standing by. Run your first mission — or meet the squad first.
      </p>

      <div className="flex flex-col items-center gap-2 pt-2 sm:flex-row sm:justify-center">
        <Link href="/missions" className="btn btn-primary btn-sm">
          <Rocket size={13} /> Run your first mission
        </Link>
        <Link href="/agents/squads" className="btn btn-ghost btn-sm">
          Meet the squad
        </Link>
      </div>
    </div>
  );
}
