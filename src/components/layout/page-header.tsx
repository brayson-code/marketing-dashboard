'use client';

import type { ReactNode } from 'react';

// Consistent page top across every page. Title sits in the new --text-h1
// (Sora, 22px, tight tracking), with a small caption beneath, and an optional
// actions slot on the right for primary CTAs.
//
// Don't roll a custom <h1> in a page — use this so the rhythm stays the same
// everywhere, and the next time we tune typography it's a one-line edit.
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4 border-b border-border/40">
      <div className="space-y-1 min-w-0">
        <h1 className="text-h1 flex items-center gap-2.5">
          {icon && <span className="text-[var(--primary)] shrink-0">{icon}</span>}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <p className="text-small max-w-prose">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
