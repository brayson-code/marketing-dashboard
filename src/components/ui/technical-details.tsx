'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Wrench } from 'lucide-react';

// Collapsible "Technical details" panel — the home for raw internals (model
// names, token counts, IDs, logs) that operators don't need but engineers
// sometimes do. Closed by default; remembers your choice per storageKey.
// Extracted from the agent-detail RecentMemory pattern so every surface that
// exposes internals can hide them the same way.
export function TechnicalDetails({
  children,
  storageKey = 'technicalDetails.open',
  label = 'Technical details',
  defaultOpen = false,
}: {
  children: ReactNode;
  storageKey?: string;
  label?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === '1') setOpen(true);
      else if (raw === '0') setOpen(false);
    } catch { /* localStorage blocked — default stays */ }
  }, [storageKey]);

  const toggle = () => setOpen((v) => {
    const next = !v;
    try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* blocked */ }
    return next;
  });

  return (
    <div className="panel">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full panel-header flex items-center gap-2 text-left"
        style={{ transition: 'background-color var(--t-popover) var(--ease-out)' }}
      >
        <ChevronDown
          size={14}
          className="text-muted-foreground shrink-0"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform var(--t-popover) var(--ease-out)' }}
        />
        <Wrench size={12} className="text-muted-foreground" />
        <h3 className="text-h2">{label}</h3>
        <span className="text-small ml-auto">{open ? 'hide' : 'show'}</span>
      </button>
      {open && <div className="panel-body space-y-2">{children}</div>}
    </div>
  );
}

/** Simple label/value row for inside a TechnicalDetails panel. */
export function TechRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground/90 truncate">{value}</span>
    </div>
  );
}
