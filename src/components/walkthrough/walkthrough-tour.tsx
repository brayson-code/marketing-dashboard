'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { X, ArrowRight, Check } from 'lucide-react';
import { useWalkthrough, walkthroughVisible, requiredSteps } from './store';
import { routeMatches, type WalkthroughStep } from './steps';

// The ACTIVE guided tour: a single coaching bubble that walks a new owner through
// the required setup steps IN ORDER, pointing at exactly where to click.
//
// Two anchoring modes, so it actually GUIDES rather than waiting to be found:
//   • off the step's page → the bubble points at that step's NAV tab
//     ([data-walkthrough="nav:/connections"]) with a "Take me there" button.
//   • on the step's page  → it re-anchors to the in-page control (step.anchor)
//     with a "do it here" nudge.
// If NEITHER anchor is on screen we render nothing — that's the fix for the old
// coachmark that "re-floated as a stray prompt" when its target hid. No anchor,
// no bubble.
//
// Non-modal by design (the user must click the thing it points at): no focus trap,
// no backdrop. Dismiss with Escape or "Skip" (snoozed for the session). The calm
// persistent checklist (SetupChecklist) remains the at-a-glance progress spine.

const BUBBLE_W = 330;
const MARGIN = 12;
const GAP = 12;

interface Pos { top: number; left: number; origin: string; arrow: 'up' | 'down' }

export function WalkthroughTour() {
  const router = useRouter();
  const pathname = usePathname();
  const s = useWalkthrough();
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  // Bumped whenever we need to re-measure (route change, signal change, target mount).
  const [tick, setTick] = useState(0);

  const visible = walkthroughVisible(s);
  const required = requiredSteps();

  // The first required step that's not done and not snoozed this session.
  const step: WalkthroughStep | null = visible
    ? required.find((st) => !s.signals?.[st.id] && !s.snoozed.includes(st.id)) ?? null
    : null;
  const stepNumber = step ? required.findIndex((st) => st.id === step.id) + 1 : 0;
  const onRoute = step ? routeMatches(step.routes, pathname) : false;

  // Resolve the element to point at: in-page control when we're on the step's page,
  // otherwise the step's nav tab. Returns null when neither is mounted.
  const resolveTarget = useCallback((): HTMLElement | null => {
    if (!step) return null;
    const inPage = step.anchor && onRoute
      ? (document.querySelector(`[data-walkthrough="${step.anchor}"]`) as HTMLElement | null)
      : null;
    if (inPage) return inPage;
    return document.querySelector(`[data-walkthrough="nav:${step.cta.href}"]`) as HTMLElement | null;
  }, [step, onRoute]);

  const compute = useCallback(() => {
    const bubble = bubbleRef.current;
    const target = resolveTarget();
    if (!bubble || !target) { setPos(null); return; }
    const bw = bubble.offsetWidth || BUBBLE_W;
    const bh = bubble.offsetHeight || 170;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const t = target.getBoundingClientRect();

    // Prefer placing to the RIGHT of a nav tab (the rail is on the left); fall back
    // to below/above for in-page controls.
    const isNav = !onRoute || !(step?.anchor && document.querySelector(`[data-walkthrough="${step.anchor}"]`));
    let top: number, left: number, origin: string, arrow: 'up' | 'down';
    if (isNav && t.right + GAP + bw + MARGIN < vw) {
      top = Math.min(Math.max(MARGIN, t.top + t.height / 2 - bh / 2), vh - bh - MARGIN);
      left = t.right + GAP;
      origin = 'left center';
      arrow = 'up';
    } else {
      top = t.bottom + GAP;
      arrow = 'up';
      origin = 'top center';
      if (top + bh + MARGIN > vh && t.top - bh - GAP > MARGIN) {
        top = t.top - bh - GAP; origin = 'bottom center'; arrow = 'down';
      }
      left = Math.min(Math.max(MARGIN, t.left + t.width / 2 - bw / 2), vw - bw - MARGIN);
    }
    setPos({ top, left, origin, arrow });
  }, [resolveTarget, onRoute, step]);

  // Highlight the target + keep the bubble pinned. Re-runs when the step/route/tick
  // changes. A short rAF retry handles targets that mount a frame after navigation.
  useLayoutEffect(() => {
    if (!step) { setPos(null); return; }
    const target = resolveTarget();
    target?.classList.add('wt-target');

    let raf = requestAnimationFrame(compute);
    // Retry a few frames in case the nav/control mounts just after we run.
    let tries = 0;
    const retry = () => {
      if (tries++ > 8) return;
      if (!resolveTarget()) { raf = requestAnimationFrame(retry); return; }
      raf = requestAnimationFrame(compute);
    };
    if (!target) raf = requestAnimationFrame(retry);

    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.querySelectorAll('.wt-target').forEach((el) => el.classList.remove('wt-target'));
    };
  }, [step, pathname, tick, compute, resolveTarget]);

  // Nudge a re-measure shortly after a route change (page content settles).
  useEffect(() => {
    if (!step) return;
    const id = window.setTimeout(() => setTick((n) => n + 1), 220);
    return () => window.clearTimeout(id);
  }, [pathname, step]);

  // Escape skips the current step for the session.
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') s.snooze(step.id); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, s]);

  if (typeof document === 'undefined') return null;
  if (!step) return null;

  const Icon = step.icon;
  const titleId = `wt-${step.id}-title`;
  const bodyId = `wt-${step.id}-body`;
  const total = required.length;

  const primary = () => {
    if (onRoute) {
      // Already here — scroll the control into view and let them act.
      resolveTarget()?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      router.push(step.cta.href);
    }
  };

  return createPortal(
    <div
      ref={bubbleRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="popover animate-in"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: BUBBLE_W,
        maxWidth: 'calc(100vw - 24px)',
        zIndex: 95, // above modals (z-90), below toasts (z-100)
        transformOrigin: pos?.origin ?? 'center',
        visibility: pos ? 'visible' : 'hidden',
        padding: 14,
      }}
    >
      {/* Header: step progress + dots */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--primary)' }}
          >
            <Icon size={15} />
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Setup · Step {stepNumber} of {total}
          </div>
        </div>
        <button onClick={() => s.snooze(step.id)} className="btn btn-ghost btn-sm -mr-1 -mt-0.5" aria-label="Skip for now">
          <X size={13} />
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1 mb-2.5" aria-hidden>
        {required.map((st, i) => (
          <span
            key={st.id}
            className="h-1 rounded-full"
            style={{
              flex: 1,
              background: s.signals?.[st.id]
                ? 'var(--success)'
                : i === stepNumber - 1
                  ? 'var(--primary)'
                  : 'color-mix(in srgb, var(--surface-3) 80%, transparent)',
              transition: 'background-color var(--t-modal) var(--ease-out)',
            }}
          />
        ))}
      </div>

      <div id={titleId} className="text-sm font-semibold leading-tight">{step.title}</div>
      <p id={bodyId} className="text-xs text-muted-foreground mt-1">{step.body}</p>
      {step.costNote && (
        <p className="text-[11px] mt-1.5 rounded-md px-2 py-1"
           style={{ background: 'color-mix(in srgb, var(--warning, #f59e0b) 14%, transparent)', color: 'var(--warning, #f59e0b)' }}>
          {step.costNote}
        </p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button onClick={primary} className="btn btn-primary btn-sm">
          {onRoute ? <><Check size={13} /> Show me</> : <>{step.cta.label} <ArrowRight size={13} /></>}
        </button>
        <button onClick={() => s.snooze(step.id)} className="btn btn-ghost btn-sm">Skip</button>
        <button
          onClick={() => void s.setDisabled(true)}
          className="btn btn-ghost btn-sm ml-auto text-muted-foreground"
          title="Turn off setup guidance"
        >
          Turn off
        </button>
      </div>
    </div>,
    document.body,
  );
}
