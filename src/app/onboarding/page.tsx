'use client';

import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';

// Thin route wrapper — the wizard lives in a component so it can also be embedded
// (with onDone) by the overview-page gate. Next forbids non-PageProps exports here.
export default function OnboardingPage() {
  return <OnboardingWizard />;
}
