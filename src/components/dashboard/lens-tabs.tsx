'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Crown, Megaphone, DollarSign, Settings as SettingsIcon, Heart } from 'lucide-react';
import type { Department } from '@/components/agent-orb';
import { colorForDepartment } from '@/components/agent-orb';

// The five department lenses across the top of the Overview. A single sliding
// indicator owns the chrome (tint + underline) and translates between tabs as
// you hover, locking to whatever you click. Same pattern as Linear/Vercel —
// the indicator moves so your eye stays anchored to "what's currently chosen."
export const LENSES: Array<{ id: Department; label: string; icon: typeof Crown }> = [
  { id: 'leadership',         label: 'Leadership',        icon: Crown },
  { id: 'marketing',          label: 'Marketing',         icon: Megaphone },
  { id: 'revenue',            label: 'Revenue',           icon: DollarSign },
  { id: 'operations',         label: 'Operations',        icon: SettingsIcon },
  { id: 'client_experience',  label: 'Client Experience', icon: Heart },
];

interface IndicatorState { left: number; width: number; color: string }

// Dwell threshold before the indicator commits to a new hovered tab. Filters
// out the "I just passed my cursor over the bar" case — you have to mean it.
// 110ms reads as "instant intent" without feeling sticky on a deliberate hover.
const HOVER_DWELL_MS = 110;

export function LensTabs({ active, onChange }: { active: Department; onChange: (d: Department) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<Department, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState<IndicatorState | null>(null);
  const [hovered, setHovered] = useState<Department | null>(null);
  // Pending dwell timer + the lens it's targeting. Cancelled on cursor leave
  // or when a different tab takes over so only the latest sustained hover wins.
  const dwellRef = useRef<{ timer: ReturnType<typeof setTimeout>; target: Department } | null>(null);

  const cancelDwell = () => {
    if (dwellRef.current) {
      clearTimeout(dwellRef.current.timer);
      dwellRef.current = null;
    }
  };

  // Position the indicator over a given lens. We measure the button's offset
  // relative to the container, not the viewport — so padding on the panel
  // wrapper doesn't throw the math off.
  const positionOver = (id: Department) => {
    const btn = tabRefs.current.get(id);
    const container = containerRef.current;
    if (!btn || !container) return;
    const c = container.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    setIndicator({ left: b.left - c.left, width: b.width, color: colorForDepartment(id) });
  };

  // Schedule a hover commit. If the cursor stays on the target through the
  // dwell window, we accept and slide. If it leaves first, cancelDwell wipes
  // the pending commit so the indicator never even starts moving.
  const queueHover = (id: Department) => {
    if (dwellRef.current?.target === id) return; // already aiming here
    cancelDwell();
    const timer = setTimeout(() => {
      dwellRef.current = null;
      setHovered(id);
      positionOver(id);
    }, HOVER_DWELL_MS);
    dwellRef.current = { timer, target: id };
  };

  // useLayoutEffect for the initial paint so the indicator is in the right
  // spot on first render — no flash of "no selection." Reposition on resize
  // because flex grow changes the per-tab width.
  useLayoutEffect(() => {
    positionOver(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    const onResize = () => positionOver(hovered ?? active);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hovered]);

  // Make sure a pending dwell timer never fires after unmount.
  useEffect(() => () => cancelDwell(), []);

  // Whichever tab "owns" the chrome right now drives the label/icon color —
  // hovered if you're previewing, else the locked active selection.
  const ownedBy = hovered ?? active;

  return (
    <div
      ref={containerRef}
      className="panel p-1.5 flex items-center gap-1 overflow-x-auto relative"
      onMouseLeave={() => { cancelDwell(); setHovered(null); positionOver(active); }}
    >
      {/* Sliding indicator — the single chrome element shared across tabs.
          Translates between tab positions on hover, snaps to active on leave. */}
      {indicator && (
        <span
          aria-hidden
          className="absolute pointer-events-none rounded-lg"
          style={{
            top: 6, bottom: 6, left: 0,
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
            background: `color-mix(in srgb, ${indicator.color} 14%, transparent)`,
            boxShadow: `inset 0 -2px 0 ${indicator.color}`,
            transition:
              'transform var(--t-popover) var(--ease-out), ' +
              'width var(--t-popover) var(--ease-out), ' +
              'background-color var(--t-popover) var(--ease-out), ' +
              'box-shadow var(--t-popover) var(--ease-out)',
          }}
        />
      )}

      {LENSES.map((l) => {
        const Icon = l.icon;
        const isOwned = ownedBy === l.id;
        const c = colorForDepartment(l.id);
        return (
          <button
            key={l.id}
            ref={(el) => {
              if (el) tabRefs.current.set(l.id, el);
              else tabRefs.current.delete(l.id);
            }}
            type="button"
            // Click is an explicit commit — always instant, never dwell-gated.
            onClick={() => { cancelDwell(); onChange(l.id); setHovered(null); positionOver(l.id); }}
            // Hover passes through the dwell gate so a flyby can't drag the
            // indicator across the whole strip.
            onMouseEnter={() => queueHover(l.id)}
            onMouseLeave={() => { if (dwellRef.current?.target === l.id) cancelDwell(); }}
            className="lens-tab relative z-10 flex-1 min-w-[140px] flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium"
            style={{
              color: isOwned ? c : 'var(--muted-foreground)',
              transition: 'color var(--t-popover) var(--ease-out)',
            }}
          >
            <Icon size={15} />
            <span>{l.label}</span>
          </button>
        );
      })}
    </div>
  );
}
