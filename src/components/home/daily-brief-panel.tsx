import Link from 'next/link';
import { Sun, ArrowUpRight } from 'lucide-react';
import type { BriefItem } from '@/lib/daily-brief';

// The one thing each person opens the app to find out.
//
// PRESENTATIONAL ONLY — everything tenant-scoped is resolved in the page, because a
// child server component renders outside the page's AsyncLocalStorage scope and would
// silently read the wrong tenant. (See the note in src/app/page.tsx; this bug already
// happened once.)
//
// Renders nothing when there is nothing to do. A panel that always says something
// trains people to stop reading it.

const TONE: Record<BriefItem['urgency'], string> = {
  now: 'var(--destructive)',
  soon: 'var(--warning)',
  fyi: 'var(--muted-foreground)',
};

export function DailyBriefPanel({ title, items }: { title: string; items: BriefItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="panel p-4 space-y-2">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Sun size={14} className="text-[var(--primary)]" /> {title}
      </p>

      <div className="space-y-0.5">
        {items.slice(0, 6).map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-lg hover:bg-[var(--surface-2)] group"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: TONE[item.urgency] }}
              aria-hidden
            />
            <span className="text-sm flex-1 min-w-0">{item.text}</span>
            <ArrowUpRight
              size={13}
              className="text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0"
            />
          </Link>
        ))}
        {items.length > 6 && (
          <p className="text-[11px] text-muted-foreground px-2 pt-1">
            and {items.length - 6} more
          </p>
        )}
      </div>
    </div>
  );
}
