'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

// Two shapes for one page: a NUMBERED STEP for the thing you are doing right now, and a
// COLLAPSED SECTION for everything you only occasionally need.
//
// Client Setup was one long scroll of eight panels ordered by data type, so setting a
// client up meant scrolling past fourteen other clients to reach the form, and the order
// on screen did not match the order of the job. Carl and Pow are not technical and
// should not have to hold a map of this page in their heads.

export function Step({
  n,
  title,
  blurb,
  done,
  children,
}: {
  n: number;
  title: string;
  blurb: string;
  /** Ticked when this step has been completed for the selected client. */
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      {/* The number rail is the whole point: it says there is an order, and where you
          are in it. */}
      <div className="flex flex-col items-center shrink-0 pt-1">
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold"
          style={done
            ? { background: 'var(--primary)', color: '#fff' }
            : { background: 'var(--surface-2)', color: 'var(--muted-foreground)' }}
        >
          {n}
        </span>
        <span className="w-px flex-1 mt-1" style={{ background: 'var(--border)' }} aria-hidden />
      </div>

      <div className="flex-1 min-w-0 pb-4 space-y-2">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground max-w-prose">{blurb}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Section({
  title,
  blurb,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  blurb?: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full px-4 py-3 flex items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={14} className="text-muted-foreground" />
              : <ChevronRight size={14} className="text-muted-foreground" />}
        {Icon && <Icon size={14} className="text-[var(--primary)]" />}
        <span className="text-sm font-semibold">{title}</span>
        {blurb && <span className="text-xs text-muted-foreground">{blurb}</span>}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
