'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { SearchEntry } from '@/lib/docs-content';

// Client-side knowledge-base search over a build-time index (titles, section
// headings, and a short excerpt per page). No server round-trip — the index is
// embedded once by the layout. Scores title > heading > excerpt matches.
function score(entry: SearchEntry, q: string): number {
  const t = entry.title.toLowerCase();
  const h = entry.headings.join(' · ').toLowerCase();
  const e = entry.excerpt.toLowerCase();
  let s = 0;
  if (t.includes(q)) s += t.startsWith(q) ? 60 : 40;
  if (h.includes(q)) s += 20;
  if (e.includes(q)) s += 10;
  return s;
}

export function DocsSearch({ index }: { index: SearchEntry[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    return index
      .map((e) => ({ e, s: score(e, query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 7)
      .map((r) => r.e);
  }, [q, index]);

  useEffect(() => setActive(0), [q]);

  // Close on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const go = (slug: string) => {
    setQ('');
    setFocused(false);
    router.push(`/docs/${slug}`);
  };

  const open = focused && results.length > 0;

  return (
    <div ref={wrapRef} className="relative w-full max-w-xs">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active].slug); }
            else if (e.key === 'Escape') setFocused(false);
          }}
          placeholder="Search docs…"
          className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus-ring"
          // Inline left-padding: the unlayered global `input { padding: 6px 10px }`
          // in globals.css beats Tailwind's layered `pl-9`, so the text would slide
          // under the search icon. Inline style wins, clearing the icon (left-3 + 15px).
          style={{ paddingLeft: '2.25rem' }}
          aria-label="Search documentation"
        />
      </div>

      {open && (
        <div className="absolute z-50 mt-2 w-[min(28rem,90vw)] right-0 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {results.map((r, i) => (
              <li key={r.slug}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r.slug)}
                  className={`block w-full text-left px-4 py-2.5 transition-colors ${i === active ? 'bg-accent' : ''}`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.group}</div>
                  <div className="text-[14px] font-medium text-foreground">{r.title}</div>
                  {r.excerpt && <div className="mt-0.5 text-small line-clamp-1">{r.excerpt}</div>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
