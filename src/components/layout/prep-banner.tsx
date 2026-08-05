'use client';

import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { isInPrep, PREP_MESSAGE } from '@/lib/prep-mode';

// Tells an assistant why the app is read-only for them.
//
// The middleware already refuses the write; without this they would just see a button
// do nothing. A rule you can see is a rule you can work with, so this is permanent
// while it applies rather than dismissible.
//
// Renders nothing for everyone else, which is almost everyone.

export function PrepBanner() {
  const [until, setUntil] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (off) return;
        const v = j?.prep_until;
        // Checked against the clock here too, so a stale claim that has already expired
        // never shows a banner the middleware is no longer enforcing.
        if (typeof v === 'string' && isInPrep(v, Date.now())) setUntil(v);
      })
      .catch(() => {});
    return () => { off = true; };
  }, []);

  if (!until) return null;

  const day = new Date(until).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div
      className="px-4 py-2 text-xs flex items-center gap-2 border-b"
      style={{
        background: 'color-mix(in srgb, var(--primary) 8%, transparent)',
        borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)',
      }}
    >
      <BookOpen size={13} className="text-[var(--primary)] shrink-0" />
      <span>
        <strong>Getting ready.</strong> {PREP_MESSAGE} You start {day}.
      </span>
    </div>
  );
}
