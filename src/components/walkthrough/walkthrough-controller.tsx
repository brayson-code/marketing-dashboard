'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useWalkthrough } from './store';
import { SetupChecklist } from './setup-checklist';
import { WalkthroughTour } from './walkthrough-tour';

// Mounted once in the authed shell. Hydrates per-user walkthrough state and keeps
// setup-status fresh as the user navigates. Renders two complementary surfaces:
//   • WalkthroughTour — the ACTIVE guide: one bubble that points at the next setup
//     step's tab/control, in order (step one = connect your Claude key). It renders
//     nothing when its target isn't on screen, so it can't strand a stray prompt
//     (the failure mode that got the old coachmarks pulled).
//   • SetupChecklist — the calm, collapsible progress spine (bottom-right).
export function WalkthroughController() {
  const pathname = usePathname();
  const hydrated = useWalkthrough((st) => st.hydrated);

  useEffect(() => { void useWalkthrough.getState().hydrate(); }, []);

  useEffect(() => {
    if (hydrated) void useWalkthrough.getState().refresh();
  }, [pathname, hydrated]);

  return (
    <>
      <WalkthroughTour />
      <SetupChecklist />
    </>
  );
}
