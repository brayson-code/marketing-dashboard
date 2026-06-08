'use client';

import { useEffect, useState } from 'react';
import { Loader2, Youtube, Instagram, ExternalLink, FileImage, Video as VideoIcon, Image as ImageIcon, Filter } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ContentTabs } from '@/components/content/content-tabs';

// Unified content gallery — every post the agent can see across connected
// channels. YouTube videos + thumbnails, Instagram posts/reels/carousels, all
// rendered as cards with click-through to the original. Filter by platform or
// by media type at the top. The list reflects what the agent itself sees,
// which is the point — what the agent can write about is what you've shipped.

type Platform = 'all' | 'youtube' | 'instagram';
type MediaFilter = 'all' | 'video' | 'image';

interface YTVideo {
  id: string; title: string; description: string; published_at: string;
  thumb: string | null; thumbs: { default: string | null; medium: string | null; high: string | null; standard: string | null; maxres: string | null };
  views: number; likes: number; comments: number; url: string;
}
interface IGMedia {
  id: string; media_type: string; media_url: string | null; thumbnail_url: string | null;
  permalink: string; caption: string; timestamp: string;
  like_count: number; comments_count: number;
}

interface UnifiedItem {
  key: string;
  platform: 'youtube' | 'instagram';
  media: 'video' | 'image';
  title: string;
  caption: string;
  thumb: string | null;
  url: string;
  ts: string;             // ISO
  views: number | null;
  likes: number;
  comments: number;
  badge: string;          // small media-type tag (VIDEO / REELS / CAROUSEL / IMAGE)
}

export default function ContentLibraryPage() {
  const [platform, setPlatform] = useState<Platform>('all');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [ytLoading, setYtLoading] = useState(true);
  const [igLoading, setIgLoading] = useState(true);
  const [ytConnected, setYtConnected] = useState<boolean | null>(null);
  const [igConnected, setIgConnected] = useState<boolean | null>(null);
  const [yt, setYt] = useState<YTVideo[]>([]);
  const [ig, setIg] = useState<IGMedia[]>([]);
  const [ytError, setYtError] = useState<string | null>(null);
  const [igError, setIgError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;

    // YouTube — paginated all-videos call. ~10 quota units for a typical channel.
    fetch('/api/integrations/youtube/videos/all?max_pages=20', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        setYtConnected(!!j.connected);
        if (j.error) setYtError(j.error);
        setYt(Array.isArray(j.videos) ? j.videos : []);
      })
      .catch((e) => !cancel && setYtError((e as Error).message))
      .finally(() => !cancel && setYtLoading(false));

    // Instagram — all media, 100 per page, 20 pages = up to 2000 posts.
    fetch('/api/integrations/instagram/media?all=true&max_pages=20', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        setIgConnected(!!j.connected);
        if (j.error) setIgError(j.error);
        setIg(Array.isArray(j.media) ? j.media : []);
      })
      .catch((e) => !cancel && setIgError((e as Error).message))
      .finally(() => !cancel && setIgLoading(false));

    return () => { cancel = true; };
  }, []);

  // Merge both feeds into one chronological grid.
  const items: UnifiedItem[] = [
    ...yt.map<UnifiedItem>((v) => ({
      key: `yt:${v.id}`,
      platform: 'youtube',
      media: 'video',
      title: v.title,
      caption: v.description ?? '',
      thumb: v.thumbs.high ?? v.thumbs.medium ?? v.thumb,
      url: v.url,
      ts: v.published_at,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      badge: 'VIDEO',
    })),
    ...ig.map<UnifiedItem>((m) => {
      const t = String(m.media_type ?? '').toUpperCase();
      const isVideo = t === 'VIDEO' || t === 'REELS';
      return {
        key: `ig:${m.id}`,
        platform: 'instagram',
        media: isVideo ? 'video' : 'image',
        title: firstLine(m.caption) || (t === 'CAROUSEL_ALBUM' ? 'Carousel' : t.toLowerCase()),
        caption: m.caption ?? '',
        thumb: m.thumbnail_url ?? m.media_url,
        url: m.permalink,
        ts: m.timestamp,
        views: null,
        likes: m.like_count,
        comments: m.comments_count,
        badge: t === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : t || 'IMAGE',
      };
    }),
  ]
    .filter((x) => platform === 'all' ? true : x.platform === platform)
    .filter((x) => mediaFilter === 'all' ? true : x.media === mediaFilter)
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

  const loading = ytLoading || igLoading;
  const anyConnected = ytConnected || igConnected;

  return (
    <div className="space-y-5 animate-in">
      <PageHeader
        icon={<FileImage size={18} />}
        title="Content library"
        subtitle="Everything the agent can see across your connected channels. Filter by platform or media type."
      />

      <ContentTabs />

      {/* Filters + counts */}
      <div className="panel p-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <PlatformPill active={platform === 'all'}       onClick={() => setPlatform('all')}       label="All"       />
          <PlatformPill active={platform === 'youtube'}   onClick={() => setPlatform('youtube')}   label="YouTube"   icon={<Youtube size={12} className="text-[#ff0033]" />}    count={yt.length}/>
          <PlatformPill active={platform === 'instagram'} onClick={() => setPlatform('instagram')} label="Instagram" icon={<Instagram size={12} className="text-[#e1306c]" />} count={ig.length}/>
        </div>
        <div className="h-4 w-px bg-border/40" />
        <div className="flex items-center gap-1.5">
          <Filter size={12} className="text-muted-foreground" />
          <FilterPill active={mediaFilter === 'all'}   onClick={() => setMediaFilter('all')}   label="All media" />
          <FilterPill active={mediaFilter === 'video'} onClick={() => setMediaFilter('video')} label="Video"    icon={<VideoIcon size={11} />} />
          <FilterPill active={mediaFilter === 'image'} onClick={() => setMediaFilter('image')} label="Image"    icon={<ImageIcon size={11} />} />
        </div>
        <span className="ml-auto text-micro text-muted-foreground">
          {items.length.toLocaleString()} items
        </span>
      </div>

      {/* Empty / loading states */}
      {loading && items.length === 0 ? (
        <div className="panel p-12 flex items-center justify-center gap-2 text-small">
          <Loader2 size={14} className="animate-spin" /> Loading your archive…
        </div>
      ) : !anyConnected ? (
        <div className="panel p-10 text-center text-small space-y-2">
          <p>No social channels connected yet.</p>
          <a href="/connections" className="inline-flex items-center gap-1 text-[var(--primary)] underline">Open Connections</a>
        </div>
      ) : items.length === 0 ? (
        <div className="panel p-10 text-center text-small">
          No items match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {items.map((it) => <Card key={it.key} item={it} />)}
        </div>
      )}

      {/* Connection / error notes — only when relevant. */}
      {(ytError || igError) && (
        <div className="panel p-3 text-micro space-y-1">
          {ytError && <div className="text-destructive">YouTube: {ytError}</div>}
          {igError && <div className="text-destructive">Instagram: {igError}</div>}
        </div>
      )}
      {(!ytConnected || !igConnected) && (
        <div className="panel p-3 text-micro text-muted-foreground">
          {!ytConnected && <span>YouTube not connected. </span>}
          {!igConnected && <span>Instagram not connected (requires a Business/Creator account linked to a Facebook Page). </span>}
          <a href="/connections" className="underline">Connect channels</a> to populate this library.
        </div>
      )}
    </div>
  );
}

function Card({ item }: { item: UnifiedItem }) {
  const Icon = item.platform === 'youtube' ? Youtube : Instagram;
  const color = item.platform === 'youtube' ? '#ff0033' : '#e1306c';
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="group rounded-xl overflow-hidden border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] flex flex-col"
      style={{ transition: 'transform var(--t-popover) var(--ease-out), border-color var(--t-popover) var(--ease-out)' }}
    >
      <div className="relative aspect-video bg-muted overflow-hidden">
        {item.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumb}
            alt={item.title}
            className="w-full h-full object-cover"
            style={{ transition: 'transform var(--t-modal) var(--ease-out)' }}
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-muted-foreground">
            <ImageIcon size={28} />
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: color, color: 'white' }}>
          <Icon size={10} /> {item.badge}
        </span>
        <span className="absolute top-1.5 right-1.5 px-1 py-0.5 rounded text-[9px] font-mono bg-black/60 text-white opacity-80">
          {item.media === 'video' ? '▶' : '◧'}
        </span>
      </div>
      <div className="p-2.5 flex-1 flex flex-col gap-1.5">
        <div className="text-xs font-medium leading-snug line-clamp-2">{item.title}</div>
        <div className="mt-auto flex items-center justify-between text-micro text-muted-foreground gap-2">
          <span>{relTime(item.ts)}</span>
          <span className="font-mono tabular-nums">
            {item.views != null && <>{fmt(item.views)}v · </>}
            {fmt(item.likes)}♡ · {fmt(item.comments)}💬
          </span>
        </div>
      </div>
      <div className="px-2.5 pb-2 text-micro text-muted-foreground inline-flex items-center gap-1 opacity-60 group-hover:opacity-100" style={{ transition: 'opacity var(--t-popover) var(--ease-out)' }}>
        open original <ExternalLink size={9} />
      </div>
    </a>
  );
}

function PlatformPill({ active, onClick, label, icon, count }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium"
      style={{
        background: active ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--muted-foreground)',
        transition: 'background-color var(--t-popover) var(--ease-out), color var(--t-popover) var(--ease-out)',
      }}
    >
      {icon} {label}
      {typeof count === 'number' && <span className="text-[10px] opacity-70">· {count}</span>}
    </button>
  );
}

function FilterPill({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px]"
      style={{
        background: active ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--muted-foreground)',
        transition: 'background-color var(--t-popover) var(--ease-out), color var(--t-popover) var(--ease-out)',
      }}
    >
      {icon} {label}
    </button>
  );
}

function relTime(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo ago`;
  return `${Math.floor(s / (86400 * 365))}y ago`;
}

function firstLine(s: string | undefined): string {
  if (!s) return '';
  const line = s.split('\n').find((x) => x.trim().length > 0) ?? '';
  return line.length > 80 ? `${line.slice(0, 78)}…` : line;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
