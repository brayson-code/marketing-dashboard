'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';
import { useWalkthrough } from '@/components/walkthrough/store';

// Shows the onboarding wizard as a full-screen overlay when the current workspace
// hasn't finished onboarding, and hides it the moment the wizard completes.
//
// The wizard is rendered through a PORTAL to <body>. It must not live inside the
// page tree: the overview page (and its `.animate-in` wrapper) applies a CSS
// `transform`, and a transformed ancestor becomes the containing block for
// `position: fixed` — which would trap the overlay inside the scrolling content
// (the dashboard "clips through" as you scroll). Portaling to <body> pins it to the
// viewport. We also freeze the dashboard's scroll container while it's open.
export default function OnboardingGate() {
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/onboarding', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { setShow(!j.onboarding_complete); setChecked(true); } })
      .catch(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, []);

  // Freeze the dashboard scroll (the app scrolls inside <main.main-content>, not the
  // body) so nothing moves behind the overlay. Restored on close/unmount.
  useEffect(() => {
    if (!show) return;
    const main = document.querySelector('main.main-content') as HTMLElement | null;
    const prevMain = main?.style.overflow ?? '';
    const prevBody = document.body.style.overflow;
    if (main) main.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      if (main) main.style.overflow = prevMain;
      document.body.style.overflow = prevBody;
    };
  }, [show]);

  if (!mounted || !checked || !show) return null;
  return createPortal(
    <OnboardingWizard
      onDone={() => {
        setShow(false);
        // Hand off to the post-onboarding walkthrough: surface the setup checklist
        // (it self-gates to owners + re-reads live completion).
        useWalkthrough.getState().onOnboardingDone();
      }}
    />,
    document.body,
  );
}
