'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useWalkthrough } from './store';
import { SetupChecklist } from './setup-checklist';

// Mounted once in the authed shell. Hydrates per-user walkthrough state and keeps
// setup-status fresh as the user navigates. Shows the persistent "Finish setup"
// checklist. (The anchored coachmark popups were removed — they re-floated as stray
// prompts when their target hid; the checklist is the calmer, non-intrusive guide.)
export function WalkthroughController() {
  const pathname = usePathname();
  const hydrated = useWalkthrough((st) => st.hydrated);

  useEffect(() => { void useWalkthrough.getState().hydrate(); }, []);

  useEffect(() => {
    if (hydrated) void useWalkthrough.getState().refresh();
  }, [pathname, hydrated]);

  return <SetupChecklist />;
}
