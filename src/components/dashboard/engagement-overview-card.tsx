'use client';

import Link from 'next/link';
import { MessagesSquare, ChevronRight, Smartphone, Radio } from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import type { Engagement, Signal } from '@/types';

// Compact Overview widget for Engagement — sits in the content command-center row
// so the Overview tells the inbound story too: who's reaching out across channels.
//   • cross-channel tallies (X · LinkedIn · Signals) from /api/engagement + /api/signals
//   • SMS threads + how many are awaiting a reply (latest message inbound)
//   • the latest inbound SMS preview
//   • a link to the full /engagement page.

interface SmsMsg { direction: 'in' | 'out'; body: string; created_at: string }
interface Thread { contact: string; messages: SmsMsg[]; latest_at: string }
interface SmsPayload { conversations?: Thread[] }

export function EngagementOverviewCard() {
  const { data: engagements } = useSmartPoll<Engagement[]>(
    () => fetch('/api/engagement', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 60_000 },
  );
  const { data: signals } = useSmartPoll<Signal[]>(
    () => fetch('/api/signals', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 60_000 },
  );
  const { data: sms } = useSmartPoll<SmsPayload>(
    () => fetch('/api/engagement/sms', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 60_000 },
  );

  const list = Array.isArray(engagements) ? engagements : [];
  const xCount = list.filter((e) => e.platform === 'x').length;
  const linkedInCount = list.filter((e) => e.platform === 'linkedin' && e.action_type === 'comment').length;
  const signalCount = Array.isArray(signals) ? signals.length : 0;

  const threads = sms?.conversations ?? [];
  // A thread is "awaiting reply" when its most recent message came inbound.
  const awaiting = threads.filter((t) => t.messages[t.messages.length - 1]?.direction === 'in').length;

  // Latest inbound text across all threads, for the preview line.
  const latestInbound = threads
    .flatMap((t) => t.messages.filter((m) => m.direction === 'in'))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]?.body ?? '';

  const channels = [
    { label: 'X', count: xCount, color: '#1d9bf0' },
    { label: 'LinkedIn', count: linkedInCount, color: '#0a66c2' },
    { label: 'Signals', count: signalCount, color: 'var(--primary)' },
  ].filter((c) => c.count > 0);

  const isEmpty = channels.length === 0 && threads.length === 0;

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header items-center">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <MessagesSquare size={14} className="text-[var(--primary)]" /> Engagement
        </h3>
        <Link href="/engagement" className="text-[10px] text-[var(--primary)] hover:underline inline-flex items-center gap-0.5">
          Open Engagement <ChevronRight size={11} />
        </Link>
      </div>

      <div className="panel-body flex-1 flex flex-col gap-3">
        {isEmpty ? (
          <div className="flex-1 grid place-items-center text-center px-2 py-6">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Replies, comments, and texts your agents handle show up in{' '}
              <Link href="/engagement" className="text-[var(--primary)] hover:underline">Engagement</Link>.
            </p>
          </div>
        ) : (
          <>
            {/* Cross-channel tallies */}
            {channels.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                  <Radio size={11} className="text-[var(--primary)]" /> Channels
                </div>
                <div className="flex flex-wrap gap-1">
                  {channels.map((c) => (
                    <span
                      key={c.label}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none border"
                      style={{
                        background: `color-mix(in srgb, ${c.color} 15%, transparent)`,
                        color: c.color,
                        borderColor: `color-mix(in srgb, ${c.color} 45%, transparent)`,
                      }}
                    >
                      {c.label} <span className="opacity-70 font-mono">×{c.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* SMS thread + awaiting counts */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Smartphone size={10} /> SMS threads</div>
                <div className="text-lg font-semibold mt-0.5 tabular-nums">{threads.length}</div>
              </div>
              <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
                <div className="text-[10px] text-muted-foreground">Awaiting reply</div>
                <div className="text-lg font-semibold mt-0.5 tabular-nums">{awaiting}</div>
              </div>
            </div>

            {/* Latest inbound text */}
            {latestInbound && (
              <div className="border-t border-border/40 pt-2.5">
                <div className="text-[10px] text-muted-foreground mb-0.5">Latest inbound</div>
                <p className="text-xs text-foreground/90 line-clamp-2 leading-snug">&ldquo;{latestInbound}&rdquo;</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
