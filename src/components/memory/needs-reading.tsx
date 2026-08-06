'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Sparkles, Clock, ChevronDown, ChevronRight, Bot } from 'lucide-react';
import {
  briefingsQueue, docTitle, BUCKET_LABEL,
  type QueueDoc, type QueueBucket,
} from '@/lib/briefings-queue';

// "Needs reading" — the assistant's view of Briefings.
//
// Sits above the library rather than replacing it: browsing is right for finding a
// specific document, and this is right for the question nobody else answers — what did
// an agent write that nobody has looked at?
//
// Renders nothing when the queue is empty. A section that is permanently present stops
// being read, which would be a particularly poor joke on this one.

const ICON: Record<QueueBucket, typeof Bot> = {
  unread: Bot,
  stale: Clock,
};

const TONE: Record<QueueBucket, string> = {
  unread: 'var(--primary)',
  stale: 'var(--muted-foreground)',
};

export function NeedsReading({
  docs,
  onPick,
}: {
  docs: ReadonlyArray<QueueDoc>;
  onPick?: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  // The clock is an external store: reading Date.now() during render is impure, and
  // setting it from an effect cascades. Null on the server so SSR and hydration cannot
  // disagree about how many days old a draft is.
  const now = useSyncExternalStore(
    (cb) => { const id = setInterval(cb, 3_600_000); return () => clearInterval(id); },
    () => Math.floor(Date.now() / 3_600_000) * 3_600_000,
    () => null,
  );

  const groups = useMemo(() => {
    const q = now === null ? [] : briefingsQueue(docs, now);
    const by: Record<QueueBucket, typeof q> = { unread: [], stale: [] };
    for (const item of q) by[item.bucket].push(item);
    return by;
  }, [docs, now]);

  const total = groups.unread.length + groups.stale.length;
  if (now === null || total === 0) return null;

  return (
    <div className="panel overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center gap-2 text-left"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} className="text-muted-foreground" />
              : <ChevronRight size={14} className="text-muted-foreground" />}
        <Sparkles size={14} className="text-[var(--primary)]" />
        <span className="text-sm font-semibold">Needs reading</span>
        <span className="text-xs text-muted-foreground">
          {groups.unread.length > 0 && `${groups.unread.length} written by an agent`}
          {groups.unread.length > 0 && groups.stale.length > 0 && ' · '}
          {groups.stale.length > 0 && `${groups.stale.length} going stale`}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-3">
          {(['unread', 'stale'] as QueueBucket[]).map(b => {
            const items = groups[b];
            if (items.length === 0) return null;
            const Icon = ICON[b];
            return (
              <div key={b} className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider flex items-center gap-1.5" style={{ color: TONE[b] }}>
                  <Icon size={11} /> {BUCKET_LABEL[b]} ({items.length})
                </p>
                {items.slice(0, 8).map(({ doc, reason }) => (
                  <button
                    key={doc.id}
                    onClick={() => onPick?.(doc.id)}
                    className="w-full text-left rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-2)]"
                  >
                    <p className="text-xs font-medium truncate">{docTitle(doc)}</p>
                    <p className="text-[11px] text-muted-foreground">{reason}</p>
                  </button>
                ))}
                {items.length > 8 && (
                  <p className="text-[11px] text-muted-foreground px-2.5">
                    +{items.length - 8} more
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
