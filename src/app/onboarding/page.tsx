'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConnectPanel from '@/components/connections/connect-panel';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Eye,
  Lightbulb,
  Loader2,
  PartyPopper,
  Plug,
  Rocket,
  Sparkles,
  Timer,
  UserCircle2,
  Zap,
} from 'lucide-react';

const INPUT = 'px-3 py-2 rounded-lg border border-border bg-background text-sm w-full';

// ─── Types ──────────────────────────────────────────────────────────────────
type Role = 'owner' | 'assistant' | 'client';
type Autonomy = 'observe' | 'propose' | 'act_notify' | 'full_auto';

interface BusinessProfile {
  businessName: string;
  industry: string;
  teamSize: string;
  website: string;
  linkedin: string;
  instagram: string;
}

interface WizardData {
  role: Role | null;
  autonomy: Autonomy;
  business: BusinessProfile;
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

const AUTONOMY_STOPS: Array<{ id: Autonomy; label: string; desc: string }> = [
  { id: 'observe', label: 'Observe', desc: 'Watches and learns. Never acts or messages.' },
  { id: 'propose', label: 'Propose', desc: 'Drafts everything for your one-tap approval.' },
  { id: 'act_notify', label: 'Act + Notify', desc: 'Acts on routine work, then tells you what it did.' },
  { id: 'full_auto', label: 'Full Auto', desc: 'Runs the playbook end-to-end. Hands off.' },
];

// Each step: hero copy (left panel) + which fields gate "Continue".
const STEPS = [
  { key: 'welcome', kicker: 'Step 1 · Welcome', headline: 'Welcome to your Command Centre.', icon: Rocket },
  { key: 'profile', kicker: 'Step 2 · Your business', headline: 'Tell us who you are.', icon: Building2 },
  { key: 'stack', kicker: 'Step 3 · Your stack', headline: 'Plug in your channels.', icon: Plug },
  { key: 'autonomy', kicker: 'Step 4 · Autonomy', headline: 'How much should it run on its own?', icon: Zap },
  { key: 'audit', kicker: 'Step 5 · The numbers', headline: 'What is your time worth?', icon: Timer },
  { key: 'done', kicker: 'All set', headline: 'Your command centre is ready.', icon: PartyPopper },
] as const;

const WEEKS = 52;
const fmtUsd = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WizardData>({
    role: null,
    autonomy: 'propose',
    business: { businessName: '', industry: '', teamSize: '', website: '', linkedin: '', instagram: '' },
    audit: { annual_revenue: '', annual_profit: '', hours_per_week: '', admin_percentage: '' },
  });

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
          router.replace('/');
          return;
        }
        const bp = json.business_profile;
        if (bp && typeof bp === 'object') {
          setData((d) => ({
            ...d,
            role: bp.role ?? d.role,
            autonomy: (bp.autonomy as Autonomy) ?? d.autonomy,
            business: {
              businessName: bp.businessName ?? d.business.businessName,
              industry: bp.industry ?? d.business.industry,
              teamSize: bp.teamSize ?? d.business.teamSize,
              website: bp.website ?? d.business.website,
              linkedin: bp.linkedin ?? d.business.linkedin,
              instagram: bp.instagram ?? d.business.instagram,
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
  }, [router]);

  const isLast = step === STEPS.length - 1;
  const meta = STEPS[step];

  // Live $/hr preview for the audit step.
  const dollarPerHour = useMemo(() => {
    const profit = Number(data.audit.annual_profit) || 0;
    const hrs = Number(data.audit.hours_per_week) || 0;
    const annualHours = hrs * WEEKS;
    return annualHours > 0 && profit > 0 ? profit / annualHours : null;
  }, [data.audit.annual_profit, data.audit.hours_per_week]);

  // Required-field gating per step.
  const canContinue = useMemo(() => {
    switch (meta.key) {
      case 'welcome':
        return data.role != null;
      case 'profile':
        return data.business.businessName.trim().length > 0 && data.business.industry !== '' && data.business.teamSize !== '';
      case 'stack':
        return true; // skippable
      case 'autonomy':
        return true; // always has a default
      case 'audit':
        return true; // optional but PUT on continue
      default:
        return true;
    }
  }, [meta.key, data]);


  // Save the Key Audit to the EXISTING /api/roi endpoint when leaving step 5.
  const saveAudit = useCallback(async () => {
    const a = data.audit;
    // Nothing entered → nothing to save.
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
    } catch {
      /* non-blocking — don't trap the user on a network hiccup */
    }
  }, [data.audit]);

  const goNext = useCallback(async () => {
    setError(null);
    if (meta.key === 'audit') await saveAudit();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, [meta.key, saveAudit]);

  const goBack = useCallback(() => {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  // Final submit → persist profile, then enter the dashboard.
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
          businessProfile: data.business,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Could not save your setup');
      }
      router.push('/');
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }, [data, router]);

  const progress = (step / (STEPS.length - 1)) * 100;
  const HeroIcon = meta.icon;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#0a0a0f] text-foreground dark">
      {/* Ambient emerald/amber glows over near-black */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(900px circle at 12% -5%, rgba(16,217,130,0.10), transparent 45%), radial-gradient(1100px circle at 105% 110%, rgba(245,166,35,0.06), transparent 50%)',
        }}
      />

      {/* Thin visual progress bar */}
      <div className="absolute inset-x-0 top-0 z-20 h-1 bg-white/5">
        <div
          className="h-full bg-[var(--primary)] transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%`, boxShadow: '0 0 12px rgba(16,217,130,0.6)' }}
        />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col md:flex-row">
        {/* ── Left ~40%: glass hero ─────────────────────────────── */}
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

          {/* Step dots */}
          <div className="relative flex items-center gap-2">
            {STEPS.map((s, i) => (
              <span
                key={s.key}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 26 : 8,
                  background: i <= step ? 'var(--primary)' : 'rgba(255,255,255,0.16)',
                }}
              />
            ))}
          </div>
        </aside>

        {/* ── Right ~60%: form card with slide/fade ─────────────── */}
        <main className="relative flex flex-1 items-center justify-center overflow-y-auto p-6 md:p-10">
          <div className="w-full max-w-xl">
            {/* Slide/fade keyed on step */}
            <div key={step} className="animate-slide-in">
              <div className="panel p-6 md:p-8">
                {/* Mobile kicker (hero is hidden < md) */}
                <div className="mb-4 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400 md:hidden">
                  <HeroIcon size={13} /> {meta.kicker}
                </div>

                {meta.key === 'welcome' && <WelcomeStep role={data.role} onPick={(role) => setData((d) => ({ ...d, role }))} />}

                {meta.key === 'profile' && (
                  <ProfileStep
                    value={data.business}
                    onChange={(business) => setData((d) => ({ ...d, business }))}
                  />
                )}

                {meta.key === 'stack' && <StackStep />}

                {meta.key === 'autonomy' && (
                  <AutonomyStep value={data.autonomy} onChange={(autonomy) => setData((d) => ({ ...d, autonomy }))} />
                )}

                {meta.key === 'audit' && (
                  <AuditStep
                    value={data.audit}
                    onChange={(audit) => setData((d) => ({ ...d, audit }))}
                    dollarPerHour={dollarPerHour}
                  />
                )}

                {meta.key === 'done' && <DoneStep role={data.role} />}

                {error && (
                  <div className="mt-5 rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">
                    {error}
                  </div>
                )}

                {/* ── Footer: Back / Continue ─────────────────── */}
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
                    {meta.key === 'stack' && (
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

// ─── Step 1: Welcome & role ───────────────────────────────────────────────────
function WelcomeStep({ role, onPick }: { role: Role | null; onPick: (r: Role) => void }) {
  const options: Array<{ id: Role; label: string; desc: string }> = [
    { id: 'owner', label: "I'm the business owner", desc: 'You run the show. The centre works for you.' },
    { id: 'assistant', label: "I'm the assistant (VA)", desc: 'You operate it on the owner’s behalf.' },
    { id: 'client', label: 'Setting this up for a client', desc: 'Agency / consultant configuring for someone else.' },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Welcome to your Command Centre.</h1>
      <p className="text-sm text-muted-foreground">First, who are you here? This tailors how we talk to you.</p>
      <div className="space-y-2.5">
        {options.map((o) => {
          const active = role === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
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

// ─── Step 3: Connect your stack ───────────────────────────────────────────────
// Real OAuth connect flow (Nango), shared with the standalone Connections panel.
// Degrades to a clear "not linked yet" state until Nango keys + dev apps are set.
function StackStep() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Connect your stack.</h1>
      <p className="text-xs text-muted-foreground">
        Link the channels your agents should watch and post to. You can connect more later, or skip for now.
      </p>
      <ConnectPanel />
    </div>
  );
}

// ─── Step 4: Autonomy ─────────────────────────────────────────────────────────
function AutonomyStep({ value, onChange }: { value: Autonomy; onChange: (v: Autonomy) => void }) {
  const activeIdx = AUTONOMY_STOPS.findIndex((s) => s.id === value);
  const active = AUTONOMY_STOPS[activeIdx];
  const icons = [Eye, Lightbulb, Zap, Rocket];
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">How much should it run on its own?</h1>
      <p className="text-xs text-muted-foreground">You can change this anytime. We recommend starting at Propose.</p>

      {/* Segmented control */}
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

      {/* Track with current stop highlighted */}
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

// ─── Step 5: Key Audit ────────────────────────────────────────────────────────
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

// ─── Step 6: Done ─────────────────────────────────────────────────────────────
function DoneStep({ role }: { role: Role | null }) {
  const who =
    role === 'assistant' ? 'You’re set up to operate it.' : role === 'client' ? 'Your client’s centre is set up.' : 'Everything is wired and ready.';
  return (
    <div className="space-y-4 text-center">
      <div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: 'rgba(16,217,130,0.14)', border: '1px solid rgba(16,217,130,0.35)', boxShadow: '0 0 32px rgba(16,217,130,0.25)' }}
      >
        <PartyPopper size={28} className="text-[var(--primary)]" />
      </div>
      <h1 className="text-2xl font-semibold">Your command centre is ready.</h1>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">
        {who} Your agent squad is standing by. Hit the button below to step inside.
      </p>
    </div>
  );
}
