'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, ChevronDown, Sparkles, ArrowRight, BellOff, ListChecks, X } from 'lucide-react';
import { WALKTHROUGH_STEPS } from './steps';
import {
  useWalkthrough, walkthroughVisible, requiredSteps, requiredDoneCount, allRequiredDone,
} from './store';

// Persistent, collapsible setup checklist — the spine of the post-onboarding
// walkthrough. Owner-gated. Lives bottom-right; collapses to a pill. Each row is
// live (driven by /api/setup-status), deep-links to its tab, and ticks itself the
// moment the underlying action is done. At 100% of REQUIRED steps it celebrates
// once, then retires for good (per-user `celebrated`).
export function SetupChecklist() {
  const s = useWalkthrough();
  const visible = walkthroughVisible(s);
  const signals = s.signals;
  const reqTotal = requiredSteps().length;
  const reqDone = requiredDoneCount(signals);
  const done = allRequiredDone(signals);

  // Celebrate once, then collapse + mark celebrated so it never returns.
  useEffect(() => {
    if (visible && done && !s.celebrated) {
      const t = window.setTimeout(() => { void s.markCelebrated(); s.setExpanded(false); }, 3600);
      return () => window.clearTimeout(t);
    }
  }, [visible, done, s.celebrated]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;
  if (done && s.celebrated) return null; // fully retired

  // Celebration moment.
  if (done && !s.celebrated) {
    return (
      <div className="fixed bottom-6 right-6 z-[80] w-[300px] popover animate-in" style={{ padding: 16 }} role="status">
        <button
          onClick={() => { void s.markCelebrated(); s.setExpanded(false); }}
          className="btn btn-ghost btn-sm absolute top-2 right-2"
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
        <div className="flex items-center gap-2.5">
          <Sparkles size={18} className="text-[var(--primary)]" />
          <div className="text-sm font-semibold">You&apos;re all set!</div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Your AI team is configured and ready to work.</p>
      </div>
    );
  }

  // Collapsed pill.
  if (!s.expanded) {
    return (
      <button
        onClick={() => s.setExpanded(true)}
        className="fixed bottom-6 right-6 z-[80] popover flex items-center gap-2.5 animate-in"
        style={{ padding: '10px 14px' }}
      >
        <ListChecks size={16} className="text-[var(--primary)]" />
        <span className="text-sm font-medium">Finish setup</span>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--primary)' }}>
          {reqDone}/{reqTotal}
        </span>
      </button>
    );
  }

  const optional = WALKTHROUGH_STEPS.filter((st) => !st.required);

  return (
    <div className="fixed bottom-6 right-6 z-[80] w-[340px] max-w-[calc(100vw-24px)] popover animate-in" style={{ padding: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/60">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Finish setting up</div>
          <div className="text-[11px] text-muted-foreground">{reqDone} of {reqTotal} essentials done</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => void s.setDisabled(true)} className="btn btn-ghost btn-sm" title="Turn off setup tips" aria-label="Turn off setup tips">
            <BellOff size={13} />
          </button>
          <button onClick={() => s.setExpanded(false)} className="btn btn-ghost btn-sm" aria-label="Collapse">
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)]">
        <div className="h-full rounded-r"
             style={{ width: `${(reqDone / reqTotal) * 100}%`, background: 'var(--primary)', transition: 'width var(--t-modal) var(--ease-out)' }} />
      </div>

      {/* Required steps */}
      <div className="p-2 space-y-0.5 max-h-[52vh] overflow-y-auto" data-stagger>
        {requiredSteps().map((st) => <ChecklistRow key={st.id} stepId={st.id} done={!!signals?.[st.id]} />)}

        {optional.length > 0 && (
          <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Optional</div>
        )}
        {optional.map((st) => <ChecklistRow key={st.id} stepId={st.id} done={!!signals?.[st.id]} />)}
      </div>
    </div>
  );
}

function ChecklistRow({ stepId, done }: { stepId: string; done: boolean }) {
  const step = WALKTHROUGH_STEPS.find((s) => s.id === stepId)!;
  const setExpanded = useWalkthrough((s) => s.setExpanded);

  const inner = (
    <>
      <span className="shrink-0 mt-0.5">
        {done
          ? <CheckCircle2 size={16} className="text-[var(--success)]" />
          : <Circle size={16} className="text-muted-foreground/40" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`text-[13px] font-medium block leading-tight ${done ? 'text-muted-foreground line-through' : ''}`}>
          {step.title}
        </span>
        {!done && <span className="text-[11px] text-muted-foreground block mt-0.5">{step.body}</span>}
      </span>
      {!done && <ArrowRight size={13} className="shrink-0 mt-0.5 text-muted-foreground/60" />}
    </>
  );

  if (done) {
    return <div className="flex items-start gap-2 px-2 py-1.5 rounded-lg" aria-label={`${step.title} — completed`}>{inner}</div>;
  }
  return (
    <Link
      href={step.cta.href}
      onClick={() => setExpanded(false)}
      className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
      style={{ transition: 'background-color var(--t-press) var(--ease-out)' }}
    >
      {inner}
    </Link>
  );
}
