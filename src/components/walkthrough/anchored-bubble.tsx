'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useWalkthrough } from './store';
import type { WalkthroughStep } from './steps';

// An anchored coaching "bubble" that points at the control a setup step needs.
// Portal to <body> + getBoundingClientRect positioning (the house pattern from
// lens-tabs/content-tabs) so a transformed ancestor can't trap it. When the step's
// anchor element isn't on the page, the bubble floats above the checklist.
//
// Deliberately NON-MODAL: the whole point is for the user to interact with the page
// (click the control it points at), so we do NOT set aria-modal, do NOT trap focus,
// and do NOT steal focus on open — that would be wrong for a coachmark. It stays
// keyboard-reachable (portaled last in the DOM) and dismissible with Escape.

const BUBBLE_W = 320;
const MARGIN = 12;
const GAP = 10;

interface Pos { top: number; left: number; origin: string }

export function AnchoredBubble({ step, stepId }: { step: WalkthroughStep; stepId: string }) {
  const router = useRouter();
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const dismiss = useCallback(() => useWalkthrough.getState().snooze(stepId), [stepId]);

  const selector = step.anchor ? `[data-walkthrough="${step.anchor}"]` : null;
  const targetEl = useCallback(
    () => (selector ? (document.querySelector(selector) as HTMLElement | null) : null),
    [selector],
  );

  const compute = useCallback(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const bw = bubble.offsetWidth || BUBBLE_W;
    const bh = bubble.offsetHeight || 160;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const target = targetEl();
    if (!target) {
      // Float above the checklist widget (bottom-right).
      setPos({ top: Math.max(MARGIN, vh - bh - 96), left: Math.max(MARGIN, vw - bw - 24), origin: 'bottom right' });
      return;
    }
    const t = target.getBoundingClientRect();
    let top = t.bottom + GAP;
    let origin = 'top center';
    if (top + bh + MARGIN > vh && t.top - bh - GAP > MARGIN) {
      top = t.top - bh - GAP;
      origin = 'bottom center';
    }
    let left = t.left + t.width / 2 - bw / 2;
    left = Math.min(Math.max(MARGIN, left), vw - bw - MARGIN);
    setPos({ top, left, origin });
  }, [targetEl]);

  // Position after mount (bubble measured) and keep it pinned on scroll/resize. The
  // bubble renders hidden until `pos` is set, so deferring the first measure to a rAF
  // avoids both a visible flash and a synchronous setState in the effect body.
  useLayoutEffect(() => {
    const target = targetEl();
    target?.classList.add('coachmark-target');

    let raf = requestAnimationFrame(compute);
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      // Re-query rather than rely on the captured ref, so we never leave a highlight
      // ring on a stale/replaced element.
      (selector ? document.querySelector(selector) : null)?.classList.remove('coachmark-target');
    };
  }, [compute, targetEl, selector]);

  // Escape dismisses (non-modal: a single global listener, no focus management).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  const onPrimary = () => {
    const target = targetEl();
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      router.push(step.cta.href);
      dismiss();
    }
  };

  // SSR guard: createPortal needs document. This subtree only ever renders client-
  // side (the controller is gated behind a client-only auth check), so there's no
  // hydration mismatch — but guard anyway to keep the component self-contained.
  if (typeof document === 'undefined') return null;

  const Icon = step.icon;
  const titleId = `coach-${step.id}-title`;
  const bodyId = `coach-${step.id}-body`;

  return createPortal(
    <div
      ref={bubbleRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={pos ? 'coachmark popover' : 'popover'}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: BUBBLE_W,
        maxWidth: 'calc(100vw - 24px)',
        zIndex: 95, // above z-[90] modals, below z-[100] toasts
        transformOrigin: pos?.origin ?? 'center',
        visibility: pos ? 'visible' : 'hidden',
        padding: '14px',
      }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--primary)' }}
        >
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div id={titleId} className="text-sm font-semibold leading-tight">{step.title}</div>
          <p id={bodyId} className="text-xs text-muted-foreground mt-1">{step.body}</p>
          {step.costNote && (
            <p className="text-[11px] mt-1.5 rounded-md px-2 py-1"
               style={{ background: 'color-mix(in srgb, var(--warning, #f59e0b) 14%, transparent)', color: 'var(--warning, #f59e0b)' }}>
              {step.costNote}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2.5">
            <button onClick={onPrimary} className="btn btn-primary btn-sm">{step.cta.label}</button>
            <button onClick={dismiss} className="btn btn-ghost btn-sm">Maybe later</button>
          </div>
        </div>
        <button onClick={dismiss} className="btn btn-ghost btn-sm shrink-0 -mt-1 -mr-1" aria-label="Dismiss for now">
          <X size={13} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
