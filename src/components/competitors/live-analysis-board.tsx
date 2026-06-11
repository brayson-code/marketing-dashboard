'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { ReelRow } from '@/lib/competitors';

// The reel lifecycle the board renders live. Kept local (NOT imported from
// reel-intel, which pulls server-only deps) so this stays a pure client module.
const LIVE_STATUSES = ['fetched', 'analyzing', 'scripting'];
export function isLiveReel(status: string): boolean {
  return LIVE_STATUSES.includes(status);
}

// Three lifecycle stages shown as a segmented bar across the bottom of the tile.
const STAGES = [
  { key: 'scrape', label: 'Scrape' },
  { key: 'analyze', label: 'Analyze' },
  { key: 'script', label: 'Script' },
] as const;

type StageState = 'done' | 'active' | 'pending';

function stageState(status: string, key: string): StageState {
  if (key === 'scrape') return 'done'; // a stored row means it's scraped
  if (key === 'analyze') {
    if (status === 'analyzing') return 'active';
    if (status === 'analyzed' || status === 'scripting' || status === 'scripted') return 'done';
    return 'pending';
  }
  // script
  if (status === 'scripting') return 'active';
  if (status === 'scripted') return 'done';
  return 'pending';
}

// The big stage label shown in the overlay (where we are right now).
function stageLabel(status: string): string {
  if (status === 'analyzing') return 'Analyzing';
  if (status === 'scripting') return 'Scripting';
  return 'Scraped';
}

function workingLabel(status: string): string {
  if (status === 'analyzing') return 'Reel Analyst is tearing it down…';
  if (status === 'scripting') return 'Hyperframes is writing the script…';
  return 'Queued for teardown…';
}

// The Live Analysis Board. Renders nothing when no reels are in flight; otherwise
// shows one animated card per processing reel — multiple at once during a
// watchlist sweep — each with a real-time stage stepper, a "working" pulse, and
// skeleton shimmer where the teardown will land. The parent polls fast (~2.5s)
// while this is non-empty, so the stages advance live as the agents pull data.
export function LiveAnalysisBoard({
  reels,
  handleById,
}: {
  reels: ReelRow[];
  handleById: Map<number, string>;
}) {
  if (reels.length === 0) return null;

  const accent = 'var(--primary)';
  return (
    <section className="panel relative overflow-hidden" data-live="true" style={{ ['--primary' as string]: accent }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(620px circle at 100% -20%, color-mix(in srgb, ${accent} 13%, transparent), transparent 60%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 quick-win-shimmer"
        style={{ background: `linear-gradient(115deg, transparent 38%, color-mix(in srgb, ${accent} 10%, transparent) 50%, transparent 62%)`, mixBlendMode: 'plus-lighter' }}
      />
      <div className="relative panel-header flex items-center gap-2">
        <span className="w-2 h-2 rounded-full pulse-dot" style={{ background: accent }} />
        <h2 className="text-h2">Live analysis</h2>
        <span
          className="badge text-[10px]"
          style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)` }}
        >
          {reels.length} in flight
        </span>
        <span className="text-micro text-muted-foreground ml-auto inline-flex items-center gap-1">
          <Loader2 size={11} className="animate-spin" /> agents pulling data
        </span>
      </div>
      {/* Portrait reel tiles. They're narrow, so we pack more per row and let the
          grid frame cleanly with 1, 2, 3, or many in flight (no stretched tiles). */}
      <div className="relative panel-body grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 items-start">
        {reels.map((r) => (
          <LiveReelCard
            key={r.id}
            reel={r}
            handle={r.competitor_id != null ? (handleById.get(r.competitor_id) ?? null) : null}
          />
        ))}
      </div>
    </section>
  );
}

// A single in-flight reel as a PORTRAIT tile (reel-shaped). The cover fills the
// tile; a translucent bottom gradient carries the @handle, the current stage +
// the agent line, and a 3-segment stage bar that fills as stages complete. A
// scanning line sweeps vertically while it's active.
function LiveReelCard({ reel, handle }: { reel: ReelRow; handle: string | null }) {
  const status = reel.status;
  // Fall back to a skeleton if the cover is missing OR fails to load.
  const [coverOk, setCoverOk] = useState(true);
  const showCover = !!reel.thumbnail_url && coverOk;

  return (
    <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border/50 bg-[var(--surface-2)] shadow-sm">
      {/* Cover (or skeleton placeholder). */}
      {showCover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reel.thumbnail_url!}
          alt={handle ? `@${handle} reel` : 'reel'}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setCoverOk(false)}
        />
      ) : (
        <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
      )}

      {/* Scanning line — a thin highlight sweeping vertically while active. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="reel-scan absolute inset-x-0 h-1/3"
          style={{
            background: 'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--primary) 26%, transparent) 50%, transparent)',
            mixBlendMode: 'plus-lighter',
          }}
        />
      </div>

      {/* Bottom gradient scrim → carries the overlay text + stage bar. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5"
        style={{ background: 'linear-gradient(to top, color-mix(in srgb, #000 82%, transparent), transparent)' }}
      />

      {/* Overlay content. */}
      <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] font-semibold drop-shadow-sm">{handle ? `@${handle}` : 'Reel'}</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-sm">
            <Loader2 size={9} className="animate-spin" /> {stageLabel(status)}
          </span>
        </div>

        {/* Agent working line. */}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] leading-tight text-white/85">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full pulse-dot" style={{ background: 'var(--primary)' }} />
          <span className="truncate">{workingLabel(status)}</span>
        </div>

        {/* Segmented stage bar — 3 segments fill as stages complete. */}
        <div className="mt-2 grid grid-cols-3 gap-1">
          {STAGES.map((s) => {
            const st = stageState(status, s.key);
            return (
              <div key={s.key} className="space-y-0.5">
                <div
                  className={`h-1 rounded-full ${st === 'active' ? 'reel-segment-active' : ''}`}
                  style={{
                    background:
                      st === 'pending'
                        ? 'color-mix(in srgb, #fff 22%, transparent)'
                        : 'var(--primary)',
                  }}
                />
                <div
                  className="text-[8px] font-medium tracking-wide"
                  style={{ opacity: st === 'pending' ? 0.5 : 1 }}
                >
                  {st === 'done' ? `${s.label} ✓` : s.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
