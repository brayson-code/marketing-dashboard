'use client';

import { useEffect, useState } from 'react';
import type { DocHeading } from '@/lib/docs-content';

// Right-rail "On this page" table of contents with scrollspy. Ids match the
// rendered headings (rehype-slug stamps them, parseHeadings replicates the
// slugging) so anchor jumps + active highlight line up.
export function DocsToc({ headings }: { headings: DocHeading[] }) {
  const items = headings.filter((h) => h.depth === 2 || h.depth === 3);
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    if (items.length === 0) return;
    const els = items
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el != null);
    if (els.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        // Highlight the topmost heading currently intersecting the upper band.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -65% 0px', threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [items]);

  if (items.length < 2) return null;

  return (
    <nav className="hidden xl:block sticky top-24 self-start w-[200px] shrink-0">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">On this page</div>
      <ul className="space-y-1 border-l border-border">
        {items.map((h) => (
          <li key={h.id} style={{ paddingLeft: h.depth === 3 ? 22 : 12 }}>
            <a
              href={`#${h.id}`}
              className={`block -ml-px border-l-2 py-0.5 text-[13px] leading-snug transition-colors duration-[var(--t-press)] ${
                activeId === h.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
