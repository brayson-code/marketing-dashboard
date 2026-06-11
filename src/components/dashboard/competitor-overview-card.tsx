'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Telescope, Eye, ChevronRight, Film } from 'lucide-react';
import { AgentIcon } from '@/components/agent-icon';
import { useSmartPoll } from '@/hooks/use-smart-poll';

// Compact Overview widget for the Competitor Reel Intel feature.
//   • summary stats (competitors tracked · reels analyzed)
//   • the single top reel by views (cover via the IG image proxy, with a
//     gradient placeholder on error — IG thumbnails 404 directly)
//   • the three Content/Competitor sub-agents (Reel Analyst / Ideator /
//     Optimizer) surfaced with their squad META, pulled from /api/squad
//   • a "View competitors" link to the full /competitors tab
//
// Sized to sit in the Overview grid alongside the other dashboard widgets.

// Minimal shapes — only the fields this card reads (kept local so it never
// imports the server-only competitors lib into a client component).
interface Competitor { id: number; handle: string; display_name: string | null }
interface ReelRow {
  id: number;
  url: string;
  caption: string | null;
  views: number | null;
  status: string;
  thumbnail_url: string | null;
}
interface CompetitorsPayload { competitors?: Competitor[]; reels?: ReelRow[] }

interface SquadAgent { id: string; name: string; role: string }
interface SquadPayload { agents?: SquadAgent[] }

// The Content/Competitor squad — the three reel sub-agents this feature drives.
// Surfacing them here makes them visible on the Overview with their squad META.
const REEL_AGENT_IDS = ['reel-analyst', 'reel-ideator', 'reel-optimizer'] as const;

// IG CDN thumbnails are hotlink-protected + short-lived; route through the proxy.
function coverSrc(url: string): string {
  return `/api/img-proxy?url=${encodeURIComponent(url)}`;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function CompetitorOverviewCard() {
  const { data } = useSmartPoll<CompetitorsPayload>(
    () => fetch('/api/competitors', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 60_000 },
  );
  const { data: squad } = useSmartPoll<SquadPayload>(
    () => fetch('/api/squad', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 60_000 },
  );

  const [imgFailed, setImgFailed] = useState(false);

  const competitors = data?.competitors ?? [];
  const reels = data?.reels ?? [];
  // "Analyzed" = anything that's made it through the teardown pipeline.
  const analyzed = reels.filter((r) => r.status === 'analyzed' || r.status === 'scripted').length;
  // Top reel by views (skip rows with no metric).
  const topReel = reels
    .filter((r) => r.views != null)
    .reduce<ReelRow | null>((best, r) => (best == null || (r.views ?? 0) > (best.views ?? 0) ? r : best), null);

  // The three reel sub-agents, in registry order, with their live squad META.
  const reelAgents = REEL_AGENT_IDS
    .map((id) => (squad?.agents ?? []).find((a) => a.id === id))
    .filter((a): a is SquadAgent => Boolean(a));

  const isEmpty = competitors.length === 0 && reels.length === 0;
  const showCover = !!topReel?.thumbnail_url && !imgFailed;

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header items-center">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Telescope size={14} className="text-[var(--primary)]" /> Competitor Intel
        </h3>
        <Link href="/competitors" className="text-[10px] text-[var(--primary)] hover:underline inline-flex items-center gap-0.5">
          View competitors <ChevronRight size={11} />
        </Link>
      </div>

      <div className="panel-body flex-1 flex flex-col gap-3">
        {isEmpty ? (
          <div className="flex-1 grid place-items-center text-center px-2 py-6">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              No competitors yet — start tracking on the{' '}
              <Link href="/competitors" className="text-[var(--primary)] hover:underline">Competitors</Link> tab.
            </p>
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
                <div className="text-[10px] text-muted-foreground">Tracked</div>
                <div className="text-lg font-semibold mt-0.5 tabular-nums">{competitors.length}</div>
              </div>
              <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
                <div className="text-[10px] text-muted-foreground">Reels analyzed</div>
                <div className="text-lg font-semibold mt-0.5 tabular-nums">{analyzed}</div>
              </div>
            </div>

            {/* Top reel by views */}
            {topReel && (
              <a
                href={topReel.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 rounded-lg p-2 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40 card-hover focus-ring"
              >
                <div className="relative h-12 w-12 rounded-md overflow-hidden shrink-0 bg-muted">
                  {showCover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverSrc(topReel.thumbnail_url!)}
                      alt={topReel.caption || 'top reel'}
                      className="h-full w-full object-cover"
                      onError={() => setImgFailed(true)}
                    />
                  ) : (
                    <div
                      className="h-full w-full grid place-items-center text-white/70"
                      style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 22%, var(--surface-2)), var(--surface-2))' }}
                    >
                      <Film size={16} className="opacity-80" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-muted-foreground">Top reel</div>
                  <div className="text-xs font-medium truncate">{topReel.caption || 'Untitled reel'}</div>
                  <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1 mt-0.5 tabular-nums">
                    <Eye size={11} /> {fmt(topReel.views)} views
                  </div>
                </div>
              </a>
            )}

            {/* Content/Competitor squad — the three reel sub-agents (squad META). */}
            {reelAgents.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
                <div className="text-[10px] text-muted-foreground">Content squad</div>
                <div className="flex flex-col gap-1.5">
                  {reelAgents.map((a) => (
                    <Link
                      key={a.id}
                      href={`/agents/${a.id}`}
                      className="flex items-center gap-2 rounded-md p-1.5 -mx-1.5 card-hover focus-ring"
                    >
                      <AgentIcon id={a.id} role={a.role.toLowerCase()} size="sm" />
                      <span className="text-xs font-medium truncate flex-1">{a.name}</span>
                      <span className="badge badge-neutral text-[9px] shrink-0">{a.role}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
