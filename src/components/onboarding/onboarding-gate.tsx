'use client';

import { useEffect, useState } from 'react';
import OnboardingWizard from '@/app/onboarding/page';

// Shows the onboarding wizard as a full-screen overlay on the page it's mounted on
// (the overview) when the current workspace hasn't finished onboarding, and hides it
// the moment the wizard completes — no navigation. New clients land straight into
// setup; once they finish (incl. connecting accounts) they drop into the dashboard.
export default function OnboardingGate() {
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/onboarding', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { setShow(!j.onboarding_complete); setChecked(true); } })
      .catch(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, []);

  if (!checked || !show) return null;
  return <OnboardingWizard onDone={() => setShow(false)} />;
}
