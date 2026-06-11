'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS_NAV } from '@/lib/docs-nav';
import { Menu, X } from 'lucide-react';

// Left-hand knowledge-base nav. Sticky on desktop; a collapsible drawer on
// mobile (the "Browse docs" button toggles it). Active page is highlighted off
// usePathname so it tracks client navigation between docs.
export function DocsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (slug: string) => pathname === `/docs/${slug}`;

  return (
    <div>
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lg:hidden mb-3 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-small focus-ring"
        aria-expanded={open}
      >
        {open ? <X size={15} /> : <Menu size={15} />}
        {open ? 'Close' : 'Browse docs'}
      </button>

      <nav className={`${open ? 'block' : 'hidden'} lg:block space-y-6`}>
        {DOCS_NAV.map((group) => (
          <div key={group.group}>
            <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.group}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.slug);
                return (
                  <li key={item.slug}>
                    <Link
                      href={`/docs/${item.slug}`}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`block rounded-lg px-3 py-1.5 text-[14px] transition-colors duration-[var(--t-press)] ${
                        active
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-foreground/70 hover:text-foreground hover:bg-muted/60'
                      }`}
                    >
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
