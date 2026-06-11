'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useWalkthrough, activeStepForRoute } from './store';
import { AnchoredBubble } from './anchored-bubble';
import { SetupChecklist } from './setup-checklist';

// Mounted once in the authed shell. Hydrates per-user walkthrough state, re-reads
// live completion on every route change (so a just-finished step retires), and
// shows the one relevant coachmark for the current tab — the "land on tab X →
// X's tip" trigger — alongside the persistent setup checklist.
export function WalkthroughController() {
  const pathname = usePathname();
  const hydrated = useWalkthrough((st) => st.hydrated);

  useEffect(() => { void useWalkthrough.getState().hydrate(); }, []);

  // Re-read live completion on each route change AND once hydration finishes (so a
  // navigation that happened mid-hydrate still gets fresh signals).
  useEffect(() => {
    if (hydrated) void useWalkthrough.getState().refresh();
  }, [pathname, hydrated]);

  const active = useWalkthrough((st) => activeStepForRoute(st, pathname));

  return (
    <>
      {active && <AnchoredBubble key={active.id} step={active} stepId={active.id} />}
      <SetupChecklist />
    </>
  );
}
