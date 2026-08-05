'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Clock, CalendarClock, Moon, ChevronDown, ChevronRight, StickyNote } from 'lucide-react';
import {
  relationshipQueue, displayName, BUCKET_LABEL,
  type RelContact, type RelBucket,
} from '@/lib/relationships';

// "Needs attention" — the assistant's view of the contact list.
//
// Sits above the pipeline table rather than replacing it: the pipeline is the right
// tool for someone working deals, this is the right tool for someone keeping a
// founder's relationships from decaying. Same records, different question.
//
// Renders nothing when the queue is empty. A section that's permanently present
// stops being read.

const ICON: Record<RelBucket, typeof Clock> = {
  overdue: Clock,
  soon: CalendarClock,
  quiet: Moon,
};

const TONE: Record<RelBucket, string> = {
  overdue: 'var(--destructive)',
  soon: 'var(--warning)',
  quiet: 'var(--muted-foreground)',
};

export function NeedsAttention({
  contacts,
  onPick,
}: {
  contacts: ReadonlyArray<RelContact>;
  onPick?: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);

  // The clock is an EXTERNAL STORE, which is exactly what useSyncExternalStore is for.
  // Reading Date.now() during render is impure, and setting it from an effect causes a
  // cascading render — this avoids both. The server snapshot is null, so nothing
  // time-dependent is rendered during SSR and the two passes can't disagree on
  // hydration. Snapshot is minute-resolution so it stays referentially stable between
  // renders within the same minute rather than looping.
  const now = useSyncExternalStore(
    (onChange) => {
      const id = setInterval(onChange, 60_000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 60_000) * 60_000,
    () => null,
  );

  const groups = useMemo(() => {
    const q = now === null ? [] : relationshipQueue(contacts, now);
    const by: Record<RelBucket, typeof q> = { overdue: [], soon: [], quiet: [] };
    for (const item of q) by[item.bucket].push(item);
    return by;
  }, [contacts, now]);

  const total = groups.overdue.length + groups.soon.length + groups.quiet.length;
  if (now === null || total === 0) return null;

  return (
    <div className="panel overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} className="text-muted-foreground" />
              : <ChevronRight size={14} className="text-muted-foreground" />}
        <span className="text-sm font-semibold">Needs attention</span>
        <span className="text-xs text-muted-foreground">
          {groups.overdue.length > 0 && `${groups.overdue.length} owed a reply`}
          {groups.overdue.length > 0 && (groups.soon.length + groups.quiet.length > 0) && ' · '}
          {groups.soon.length > 0 && `${groups.soon.length} this week`}
          {groups.soon.length > 0 && groups.quiet.length > 0 && ' · '}
          {groups.quiet.length > 0 && `${groups.quiet.length} gone quiet`}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-3">
          {(['overdue', 'soon', 'quiet'] as RelBucket[]).map((b) => {
            const items = groups[b];
            if (items.length === 0) return null;
            const Icon = ICON[b];
            return (
              <div key={b} className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider flex items-center gap-1.5" style={{ color: TONE[b] }}>
                  <Icon size={11} /> {BUCKET_LABEL[b]} ({items.length})
                </p>
                {items.slice(0, 8).map(({ contact, reason }) => (
                  <button
                    key={contact.id}
                    onClick={() => onPick?.(contact.id)}
                    className="w-full text-left rounded-lg px-2.5 py-1.5 flex items-start gap-2 hover:bg-[var(--surface-2)]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {displayName(contact)}
                        {contact.company && (
                          <span className="text-muted-foreground font-normal"> · {contact.company}</span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{reason}</p>
                      {/* Notes are where an assistant keeps the human detail — surfaced
                          here so you can walk into a call already knowing it. */}
                      {contact.notes && (
                        <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                          <StickyNote size={10} className="shrink-0" />
                          {contact.notes}
                        </p>
                      )}
                    </div>
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
