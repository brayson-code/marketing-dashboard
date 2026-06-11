'use client';

import { create } from 'zustand';
import { WALKTHROUGH_STEPS, routeMatches, type Signals, type WalkthroughStep } from './steps';

// Per-user walkthrough state. Live completion comes from GET /api/setup-status;
// durable prefs (disabled / celebrated) from GET/PATCH /api/user/preferences;
// per-tab "X" dismissals are SESSION-only (in `snoozed`) so an incomplete step
// re-surfaces next visit — exactly the "until the step is actually done" rule.

interface WalkthroughState {
  hydrated: boolean;
  loading: boolean;
  role: string | null;
  onboardingComplete: boolean;
  signals: Signals | null;
  disabled: boolean;   // durable: "turn off all tips"
  celebrated: boolean; // durable: 100% party already shown
  snoozed: string[];   // session: step ids dismissed via the bubble's X
  expanded: boolean;   // checklist expanded vs collapsed pill

  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  snooze: (id: string) => void;
  setExpanded: (v: boolean) => void;
  setDisabled: (v: boolean) => Promise<void>;
  markCelebrated: () => Promise<void>;
  restart: () => Promise<void>;
  onOnboardingDone: () => void;
}

async function fetchStatus(): Promise<Partial<WalkthroughState>> {
  const r = await fetch('/api/setup-status', { cache: 'no-store' });
  if (!r.ok) return {};
  const j = await r.json();
  return {
    role: j.role ?? null,
    onboardingComplete: !!j.onboarding_complete,
    signals: (j.signals ?? null) as Signals | null,
  };
}

async function patchPrefs(patch: Record<string, boolean>): Promise<void> {
  try {
    await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch { /* best-effort; UI already updated optimistically */ }
}

export const useWalkthrough = create<WalkthroughState>((set, get) => ({
  hydrated: false,
  loading: false,
  role: null,
  onboardingComplete: false,
  signals: null,
  disabled: false,
  celebrated: false,
  snoozed: [],
  expanded: false,

  hydrate: async () => {
    if (get().hydrated || get().loading) return;
    set({ loading: true });
    try {
      const [status, prefsRes] = await Promise.all([
        fetchStatus(),
        fetch('/api/user/preferences', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const prefs = prefsRes?.preferences ?? {};
      set({
        ...status,
        disabled: !!prefs.walkthrough_disabled,
        celebrated: !!prefs.celebrated,
        hydrated: true,
        loading: false,
      });
    } catch {
      set({ hydrated: true, loading: false });
    }
  },

  refresh: async () => {
    const status = await fetchStatus();
    if (Object.keys(status).length) set(status);
  },

  snooze: (id) => set((s) => (s.snoozed.includes(id) ? s : { snoozed: [...s.snoozed, id] })),

  setExpanded: (v) => set({ expanded: v }),

  setDisabled: async (v) => {
    set({ disabled: v });
    await patchPrefs({ walkthrough_disabled: v });
  },

  markCelebrated: async () => {
    if (get().celebrated) return;
    set({ celebrated: true });
    await patchPrefs({ celebrated: true });
  },

  restart: async () => {
    // Zero `signals` synchronously too — otherwise the still-complete snapshot makes
    // the checklist replay the celebration instead of showing the steps again. null
    // signals is handled safely (everything reads via optional chaining) until the
    // refresh() below repopulates them.
    set({ disabled: false, celebrated: false, snoozed: [], expanded: true, signals: null });
    await patchPrefs({ walkthrough_disabled: false, celebrated: false });
    await get().refresh();
  },

  onOnboardingDone: () => {
    set({ expanded: true });
    void get().refresh();
  },
}));

// ─── Derived selectors (pure; computed from a state snapshot) ──────────────────

/** The owner-gated, not-disabled, post-onboarding visibility gate for the whole UI.
 *  Owner-gated: show to the workspace owner, and to solo/unconfigured workspaces with
 *  no membership row yet (role null) — but never to explicit teammates ('member' /
 *  'va'), so a colleague who joins after setup is done isn't nagged to re-configure. */
export function walkthroughVisible(s: WalkthroughState): boolean {
  const ownerLike = s.role === 'owner' || s.role == null;
  return s.hydrated && !s.disabled && ownerLike && s.onboardingComplete;
}

export function requiredSteps(): WalkthroughStep[] {
  return WALKTHROUGH_STEPS.filter((st) => st.required);
}

export function requiredDoneCount(signals: Signals | null): number {
  return requiredSteps().filter((st) => signals?.[st.id]).length;
}

export function allRequiredDone(signals: Signals | null): boolean {
  return requiredSteps().every((st) => signals?.[st.id]);
}

/** First incomplete, non-snoozed step whose anchor route matches the current path. */
export function activeStepForRoute(s: WalkthroughState, pathname: string): WalkthroughStep | null {
  if (!walkthroughVisible(s)) return null;
  for (const step of WALKTHROUGH_STEPS) {
    if (step.routes.length === 0) continue;
    if (s.signals?.[step.id]) continue;
    if (s.snoozed.includes(step.id)) continue;
    if (routeMatches(step.routes, pathname)) return step;
  }
  return null;
}
