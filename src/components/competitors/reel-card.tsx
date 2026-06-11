'use client';

import { useState } from 'react';
import {
  ExternalLink, Eye, Heart, MessageCircle, Loader2,
  FileText, Sparkles, Image as ImageIcon, Play, RefreshCw,
} from 'lucide-react';
import type { ReelRow } from '@/lib/competitors';
import { REEL_TAGS } from '@/lib/reel-tags';
import { extractShortcode, ReelPlayerModal } from './reel-embed';
import { TeardownModal } from './teardown-modal';

// IG CDN thumbnail urls are hotlink-protected + short-lived; route them through
// our image proxy so the browser can actually render the cover.
function coverSrc(url: string): string {
  return `/api/img-proxy?url=${encodeURIComponent(url)}`;
}

// One competitor reel as a card: thumbnail (click-through to the permalink),
// handle, metrics, and an expandable "Why it won" teardown pulled from
// analysis.teardown. When a reel hasn't been scripted yet (no script_draft_id),
// a "Generate script" action calls back up to the page, which re-analyzes the
// reel withScript=true and swaps the row in place.

export interface ReelCardProps {
  reel: ReelRow;
  handle: string;                 // resolved display handle for this reel
  onGenerateScript: (reel: ReelRow) => Promise<void>;
  scripting: boolean;             // is a generate-script call in flight for this reel
  onReanalyze: (reel: ReelRow) => Promise<void>;  // force a fresh scrape + teardown (refreshes cover + tags)
  reanalyzing: boolean;
}

// analysis is a loose JSON bag (the reel-analyst owns its exact shape). We read
// `teardown` (the main writeup) defensively plus a couple of optional summary
// fields, and `tags` (REEL_TAG slugs), and never assume they exist.
function readAnalysis(a: Record<string, unknown> | null) {
  if (!a || typeof a !== 'object') return { teardown: '', hook: '', format: '', tags: [] as string[] };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const tags = Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string') : [];
  return {
    teardown: str(a.teardown) || str(a.why_it_won) || str(a.summary),
    hook: str(a.hook) || str(a.hook_line),
    format: str(a.format) || str(a.content_type),
    tags,
  };
}

export function ReelCard({ reel, handle, onGenerateScript, scripting, onReanalyze, reanalyzing }: ReelCardProps) {
  const [showWhy, setShowWhy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const a = readAnalysis(reel.analysis);
  const scripted = reel.script_draft_id != null;
  const hasTeardown = a.teardown.trim().length > 0;
  // Most reels have an extractable shortcode → in-app playback. Falls back to the
  // external link if the URL has no code.
  const canPlay = extractShortcode(reel.url) != null;
  const showCover = !!reel.thumbnail_url && !imgFailed;

  // Only known REEL_TAG slugs render — shown in the card body under the metrics,
  // where they read clearly (instead of washing out over the video cover).
  const tags = a.tags.filter((slug) => REEL_TAGS[slug]);

  return (
    <div className="panel flex flex-col overflow-hidden card-hover">
      {playing && <ReelPlayerModal url={reel.url} onClose={() => setPlaying(false)} />}
      {showWhy && <TeardownModal teardown={a.teardown} handle={handle} onClose={() => setShowWhy(false)} />}

      {/* Cover → in-app playback (we embed IG; we never re-host video). */}
      <div className="group relative aspect-[4/5] bg-muted overflow-hidden">
        <button
          type="button"
          onClick={() => (canPlay ? setPlaying(true) : window.open(reel.url, '_blank', 'noreferrer'))}
          aria-label={canPlay ? 'Play reel' : 'Open on Instagram'}
          className="absolute inset-0 w-full h-full block cursor-pointer"
        >
          {showCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverSrc(reel.thumbnail_url!)}
              alt={a.hook || reel.caption || 'reel'}
              className="w-full h-full object-cover"
              style={{ transition: 'transform var(--t-modal) var(--ease-out)' }}
              onError={() => setImgFailed(true)}
            />
          ) : (
            // Graceful placeholder — IG CDN thumbnail urls are short-lived and 404.
            <div
              className="w-full h-full grid place-items-center text-white/70"
              style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 22%, var(--surface-2)), var(--surface-2))' }}
            >
              {canPlay ? <Play size={30} className="opacity-80" /> : <ImageIcon size={28} className="opacity-70" />}
            </div>
          )}
          {/* play affordance whenever a shortcode is extractable */}
          {canPlay && (
            <span className="absolute inset-0 grid place-items-center opacity-80 group-hover:opacity-100"
              style={{ transition: 'opacity var(--t-popover) var(--ease-out)' }}>
              <span className="h-12 w-12 rounded-full bg-black/55 grid place-items-center text-white backdrop-blur-sm">
                <Play size={18} className="ml-0.5" />
              </span>
            </span>
          )}
        </button>

        <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/60 text-white pointer-events-none">
          @{handle}
        </span>
        {scripted && (
          <span className="absolute top-2 right-2 badge badge-success text-[10px] py-0.5 pointer-events-none">scripted</span>
        )}

        {/* Secondary "open on IG" external link in the corner. */}
        <a
          href={reel.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open on Instagram"
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white bg-black/55 opacity-0 group-hover:opacity-100"
          style={{ transition: 'opacity var(--t-popover) var(--ease-out)' }}
        >
          open <ExternalLink size={9} />
        </a>
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* caption / hook */}
        {(reel.caption || a.hook) && (
          <p className="text-xs leading-snug line-clamp-2 text-foreground/90">
            {a.hook || reel.caption}
          </p>
        )}

        {/* metrics + posted date — wraps so the date never clips off the card */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground font-mono tabular-nums">
          <span className="inline-flex items-center gap-1" title="Views"><Eye size={11} /> {fmt(reel.views)}</span>
          <span className="inline-flex items-center gap-1" title="Likes"><Heart size={11} /> {fmt(reel.likes)}</span>
          <span className="inline-flex items-center gap-1" title="Comments"><MessageCircle size={11} /> {fmt(reel.comments)}</span>
          {reel.posted_at && <span className="text-muted-foreground/80">· {relTime(reel.posted_at)}</span>}
        </div>

        {/* Tags — in the card body, readable (no longer washed out over the video). */}
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {tags.map((slug) => {
              const { label, color } = REEL_TAGS[slug];
              return (
                <span
                  key={slug}
                  className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none border"
                  style={{
                    background: `color-mix(in srgb, ${color} 15%, transparent)`,
                    color,
                    borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
                  }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        )}

        {a.format && (
          <span className="badge badge-neutral text-[10px] self-start">{a.format}</span>
        )}

        {/* Why it won — a highlighted button (rotating-light halo) that opens a
            clean popup, so it's easy to spot + click. */}
        {hasTeardown ? (
          <button
            type="button"
            onClick={() => setShowWhy(true)}
            className="glow-cta mt-auto w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold active:scale-[0.98]"
            style={{
              background: 'color-mix(in srgb, var(--primary) 16%, var(--surface-1))',
              color: 'var(--primary)',
              border: '1px solid color-mix(in srgb, var(--primary) 35%, transparent)',
              transition: 'transform var(--t-press) var(--ease-out)',
            }}
          >
            <Sparkles size={12} /> Why it Won
          </button>
        ) : (
          <div className="mt-auto pt-1 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
            <FileText size={11} /> {reel.status === 'analyzing' ? 'Analyzing…' : 'No teardown yet'}
          </div>
        )}

        {/* Generate script (only when not yet scripted) */}
        {!scripted && (
          <button
            type="button"
            onClick={() => onGenerateScript(reel)}
            disabled={scripting}
            className="btn btn-ghost btn-sm w-full mt-1"
          >
            {scripting ? <><Loader2 size={12} className="animate-spin" /> Writing script…</> : <><FileText size={12} /> Generate script</>}
          </button>
        )}
        {scripted && (
          <a href="/drafts" className="btn btn-ghost btn-sm w-full mt-1">
            <FileText size={12} /> View script draft
          </a>
        )}

        {/* Re-analyze — re-scrape + re-run the teardown. Refreshes an expired
            cover and backfills tags on reels torn down before tags existed. */}
        <button
          type="button"
          onClick={() => onReanalyze(reel)}
          disabled={reanalyzing}
          className="btn btn-ghost btn-sm w-full !text-[11px] text-muted-foreground"
          title="Re-scrape + re-run the teardown (refreshes the cover image and tags)"
        >
          {reanalyzing ? <><Loader2 size={11} className="animate-spin" /> Re-analyzing…</> : <><RefreshCw size={11} /> Re-analyze</>}
        </button>
      </div>
    </div>
  );
}

function fmt(n: number | null): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function relTime(sec: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - sec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo ago`;
  return `${Math.floor(s / (86400 * 365))}y ago`;
}
