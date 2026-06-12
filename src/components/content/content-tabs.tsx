'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  LayoutGrid, FlaskConical, Clapperboard, Telescope, CalendarDays, FolderOpen, MessageCircle, Film, FolderUp,
} from 'lucide-react';

// Sub-nav for the Content hub. One strip, seven destinations — the six pages
// that each used to own a nav-rail entry, plus the new Overview landing. Active
// tab is derived from the pathname (longest-prefix match) so deep links +
// browser back keep working; each page is otherwise untouched. Mirrors the
// Overview LensTabs sliding indicator, minus the per-department color — one
// accent here since this is a single workflow, not five lenses.
const TABS: Array<{ href: string; label: string; icon: typeof LayoutGrid }> = [
  { href: '/content/overview', label: 'Overview',    icon: LayoutGrid },
  { href: '/content-lab',      label: 'Ideas',       icon: FlaskConical },
  { href: '/scripts',          label: 'Scripts',     icon: Clapperboard },
  { href: '/content/hyperframes', label: 'Hyperframes', icon: Film },
  { href: '/content/media',    label: 'Media',       icon: FolderUp },
  { href: '/competitors',      label: 'Competitors', icon: Telescope },
  { href: '/content',          label: 'Pipeline',    icon: CalendarDays },
  { href: '/content/library',  label: 'Library',     icon: FolderOpen },
  { href: '/engagement',       label: 'Engagement',  icon: MessageCircle },
];

// Sorted longest-href-first so /content/overview and /content/library win the
// match over the bare /content (Pipeline) prefix.
const BY_SPECIFICITY = [...TABS].sort((a, b) => b.href.length - a.href.length);

export function ContentTabs() {
  const pathname = usePathname();
  const active =
    BY_SPECIFICITY.find((t) => pathname === t.href || pathname.startsWith(t.href + '/'))?.href ??
    '/content/overview';

  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);

  // Park the indicator under the active tab on mount + whenever the route
  // changes. useLayoutEffect so there's no flash of an un-anchored strip.
  // scrollLeft must be added back: getBoundingClientRect() returns *visual*
  // coordinates (after scroll), but the indicator is positioned relative to
  // the scroll-content box — so on narrow screens where the strip scrolls
  // horizontally the indicator would sit at the wrong place without this.
  // We also scroll the active tab into view so it's always fully visible.
  useLayoutEffect(() => {
    const btn = tabRefs.current.get(active);
    const c = containerRef.current;
    if (!btn || !c) return;
    const cb = c.getBoundingClientRect();
    const bb = btn.getBoundingClientRect();
    setInd({ left: bb.left - cb.left + c.scrollLeft, width: bb.width });
    // Scroll active tab into view (centre it) without jarring full-page scroll.
    btn.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active]);

  return (
    <div ref={containerRef} className="panel p-1.5 flex items-center gap-1 overflow-x-auto relative">
      {ind && (
        <span
          aria-hidden
          className="absolute pointer-events-none rounded-lg"
          style={{
            top: 6, bottom: 6, left: 0,
            width: ind.width,
            transform: `translateX(${ind.left}px)`,
            background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
            boxShadow: 'inset 0 -2px 0 var(--primary)',
            transition:
              'transform var(--t-popover) var(--ease-out), ' +
              'width var(--t-popover) var(--ease-out)',
          }}
        />
      )}

      {TABS.map((t) => {
        const Icon = t.icon;
        const on = active === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            ref={(el) => {
              if (el) tabRefs.current.set(t.href, el);
              else tabRefs.current.delete(t.href);
            }}
            className="relative z-10 flex-1 min-w-[112px] flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium"
            style={{
              color: on ? 'var(--primary)' : 'var(--muted-foreground)',
              transition: 'color var(--t-popover) var(--ease-out)',
            }}
          >
            <Icon size={15} />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
