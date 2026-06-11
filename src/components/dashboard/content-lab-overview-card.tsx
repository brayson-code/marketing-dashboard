'use client';

import Link from 'next/link';
import { FlaskConical, ChevronRight, Flame, Lightbulb } from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';

// Compact Overview widget for the Content Lab — sits next to Competitor Intel so
// the Overview tells the whole content story: what competitors do → what to make.
//   • trending tags across your analyzed reels (from /api/competitors/trends)
//   • idea + script counts (from /api/competitors/ideas)
//   • the latest generated idea's hook
//   • a link to the full /content-lab page.

interface TrendTag { slug: string; label: string; color: string; count: number }
interface TrendPayload { topTags?: TrendTag[]; analyzedCount?: number }
interface Idea { id: number; hook: string; status: string; script_draft_id: number | null }
interface IdeasPayload { ideas?: Idea[] }

export function ContentLabOverviewCard() {
  const { data: trends } = useSmartPoll<TrendPayload>(
    () => fetch('/api/competitors/trends', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 60_000 },
  );
  const { data: ideasData } = useSmartPoll<IdeasPayload>(
    () => fetch('/api/competitors/ideas', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 60_000 },
  );

  const topTags = (trends?.topTags ?? []).slice(0, 4);
  const ideas = ideasData?.ideas ?? [];
  const scripted = ideas.filter((i) => i.script_draft_id != null).length;
  const latestHook = ideas.find((i) => i.status !== 'dismissed')?.hook ?? '';
  const isEmpty = topTags.length === 0 && ideas.length === 0;

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header items-center">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FlaskConical size={14} className="text-[var(--primary)]" /> Content Lab
        </h3>
        <Link href="/content-lab" className="text-[10px] text-[var(--primary)] hover:underline inline-flex items-center gap-0.5">
          Open Content Lab <ChevronRight size={11} />
        </Link>
      </div>

      <div className="panel-body flex-1 flex flex-col gap-3">
        {isEmpty ? (
          <div className="flex-1 grid place-items-center text-center px-2 py-6">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Analyze a few reels, then generate ideas in the{' '}
              <Link href="/content-lab" className="text-[var(--primary)] hover:underline">Content Lab</Link>.
            </p>
          </div>
        ) : (
          <>
            {/* Trending tags across analyzed reels */}
            {topTags.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                  <Flame size={11} className="text-[var(--primary)]" /> Trending
                </div>
                <div className="flex flex-wrap gap-1">
                  {topTags.map((t) => (
                    <span
                      key={t.slug}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none border"
                      style={{
                        background: `color-mix(in srgb, ${t.color} 15%, transparent)`,
                        color: t.color,
                        borderColor: `color-mix(in srgb, ${t.color} 45%, transparent)`,
                      }}
                    >
                      {t.label} <span className="opacity-70 font-mono">×{t.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Idea + script counts */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Lightbulb size={10} /> Ideas</div>
                <div className="text-lg font-semibold mt-0.5 tabular-nums">{ideas.length}</div>
              </div>
              <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
                <div className="text-[10px] text-muted-foreground">Scripts written</div>
                <div className="text-lg font-semibold mt-0.5 tabular-nums">{scripted}</div>
              </div>
            </div>

            {/* Latest idea hook */}
            {latestHook && (
              <div className="border-t border-border/40 pt-2.5">
                <div className="text-[10px] text-muted-foreground mb-0.5">Latest idea</div>
                <p className="text-xs text-foreground/90 line-clamp-2 leading-snug">&ldquo;{latestHook}&rdquo;</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
