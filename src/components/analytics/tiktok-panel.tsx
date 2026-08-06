'use client';

import { useEffect, useState } from 'react';
import { Music2, Loader2 } from 'lucide-react';

// TODO: once a Nango integration with key 'tiktok' is wired (TikTok Business
// API at https://business-api.tiktok.com) and /api/integrations/tiktok/stats
// + /api/integrations/tiktok/videos exist, this panel will surface real data
// without changes to the component shape.

interface TikTokStats {
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  follower_count?: number;
  video_views?: number;
  profile_views?: number;
  engagement_rate_pct?: number;
  avg_watch_time_sec?: number;
  start?: string;
  end?: string;
}

interface TikTokVideo {
  id: string;
  thumbnail_url: string | null;
  permalink: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
}

interface TikTokResponse {
  connected: boolean;
  stats?: TikTokStats;
  videos?: TikTokVideo[];
  error?: string;
}

export function TikTokPanel() {
  const [stats, setStats] = useState<TikTokStats | null>(null);
  const [videos, setVideos] = useState<TikTokVideo[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const r = await fetch('/api/integrations/tiktok/stats', { cache: 'no-store' })
          .then((res) => (res.ok ? (res.json() as Promise<TikTokResponse>) : null))
          .catch(() => null);
        if (cancel) return;
        setConnected(!!r?.connected);
        if (r?.error) setError(r.error);
        setStats(r?.stats ?? null);
        setVideos(Array.isArray(r?.videos) ? r.videos.slice(0, 3) : []);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Music2 size={14} className="text-[#ff0050]" />
        <h3 className="section-title">TikTok</h3>
        <span className="ml-auto text-micro text-muted-foreground">Last 30d</span>
      </div>
      <div className="panel-body space-y-3">
        {loading ? (
          <div className="py-6 flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading account…
          </div>
        ) : connected === false || !stats ? (
          <div className="py-6 text-center text-small space-y-1">
            <div>TikTok not connected.</div>
            <div className="text-micro text-muted-foreground">
              Requires a TikTok Business API connection. Connect in <a href="/connections" className="underline">/connections</a> (coming soon).
            </div>
          </div>
        ) : error ? (
          <div className="py-6 text-center text-small text-destructive">{error}</div>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              {stats.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={stats.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-muted" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{stats.display_name || stats.username || 'Account'}</div>
                {stats.username && (
                  <div className="text-micro text-muted-foreground truncate">@{stats.username}</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Stat label="Followers" value={fmt(stats.follower_count ?? 0)} accent="var(--primary)" />
              <Stat label="Video views" value={fmt(stats.video_views ?? 0)} />
              <Stat label="Profile views" value={fmt(stats.profile_views ?? 0)} />
              <Stat label="Engagement" value={pct(stats.engagement_rate_pct)} caption="likes+cmts+shares ÷ views" />
              <Stat label="Avg watch" value={secs(stats.avg_watch_time_sec)} caption="seconds per view" />
            </div>

            <div>
              <div className="text-micro text-muted-foreground mb-1.5">Recent videos</div>
              {videos.length === 0 ? (
                <div className="text-small py-3 text-center">No recent videos.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {videos.map((v) => (
                    <a
                      key={v.id}
                      href={v.permalink}
                      target="_blank" rel="noreferrer"
                      className="relative aspect-[9/16] rounded-md overflow-hidden bg-muted hover:opacity-80"
                      style={{ transition: 'opacity var(--t-popover, 160ms) var(--ease-out, ease-out)' }}
                      title={v.caption?.slice(0, 80) || 'video'}
                    >
                      {v.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-muted" />
                      )}
                      <div className="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[10px] tabular-nums bg-black/45 text-white">
                        {fmt(v.views)} views
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  caption,
  accent,
}: {
  label: string;
  value: string;
  caption?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
      <div className="text-micro text-muted-foreground">{label}</div>
      <div
        className="text-base font-semibold mt-0.5 tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {caption && <div className="text-[10px] text-muted-foreground mt-0.5">{caption}</div>}
    </div>
  );
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
function pct(n?: number): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}
function secs(n?: number): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  return `${n.toFixed(1)}s`;
}
