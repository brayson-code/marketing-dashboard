'use client';

import { useEffect, useState } from 'react';
import { Youtube, Loader2, ExternalLink } from 'lucide-react';

interface Channel {
  channel_id: string;
  title: string;
  thumb: string | null;
  subscribers: number;
  views_total: number;
  videos_total: number;
}

interface Metrics {
  start: string; end: string;
  views: number;
  estimated_minutes_watched: number;
  average_view_duration_sec: number;
  subscribers_gained: number;
  subscribers_lost: number;
  net_subs: number;
}

interface Video {
  id: string; title: string; published_at: string; thumb: string | null;
  views: number; likes: number; comments: number;
}

// YouTube panel on /analytics. Shows channel headline + last 30-day metrics
// + a short list of recent videos. Reads from /api/integrations/youtube/*,
// each of which gracefully reports "not connected" so the panel renders a
// helpful empty state instead of breaking the page.
export function YouTubePanel() {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const [s, v] = await Promise.all([
          fetch('/api/integrations/youtube/stats', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
          fetch('/api/integrations/youtube/videos?max=6', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        ]);
        if (cancel) return;
        setConnected(!!s?.connected);
        if (s?.error) setError(s.error);
        setChannel(s?.channel ?? null);
        setMetrics(s?.metrics ?? null);
        setVideos(Array.isArray(v?.videos) ? v.videos : []);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();
    // Refresh every 5 minutes — YouTube data updates slowly + the API quota is finite.
    const t = setInterval(load, 5 * 60_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Youtube size={14} className="text-[#ff0033]" />
        <h3 className="section-title">YouTube</h3>
        {channel && (
          <a
            href={`https://www.youtube.com/channel/${channel.channel_id}`}
            target="_blank" rel="noreferrer"
            className="ml-auto text-micro text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
          >
            {channel.title || 'open channel'} <ExternalLink size={10} />
          </a>
        )}
      </div>
      <div className="panel-body space-y-3">
        {loading ? (
          <div className="py-6 flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading channel…
          </div>
        ) : connected === false ? (
          <div className="py-6 text-center text-small">
            YouTube not connected. <a href="/connections" className="underline">Connect</a> to surface stats here.
          </div>
        ) : error ? (
          <div className="py-6 text-center text-small text-destructive">{error}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Stat label="Subscribers" value={fmt(channel?.subscribers ?? 0)} />
              <Stat label="Total views" value={fmt(channel?.views_total ?? 0)} />
              <Stat label="Videos" value={fmt(channel?.videos_total ?? 0)} />
            </div>

            {metrics && (
              <div>
                <div className="text-micro text-muted-foreground mb-1">Last 30 days · {metrics.start} → {metrics.end}</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat label="Views" value={fmt(metrics.views)} accent="var(--primary)" />
                  <Stat label="Watch min" value={fmt(metrics.estimated_minutes_watched)} />
                  <Stat label="Avg view (s)" value={String(metrics.average_view_duration_sec)} />
                  <Stat
                    label="Net subs"
                    value={(metrics.net_subs > 0 ? '+' : '') + fmt(metrics.net_subs)}
                    accent={metrics.net_subs > 0 ? 'var(--primary)' : metrics.net_subs < 0 ? 'var(--destructive)' : undefined}
                  />
                </div>
              </div>
            )}

            <div>
              <div className="text-micro text-muted-foreground mb-1.5">Recent uploads</div>
              {videos.length === 0 ? (
                <div className="text-small py-3 text-center">No recent uploads.</div>
              ) : (
                <div className="space-y-1.5">
                  {videos.map((v) => (
                    <a
                      key={v.id}
                      href={`https://www.youtube.com/watch?v=${v.id}`}
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-2.5 rounded-md p-1.5 hover:bg-muted/30 transition-colors"
                    >
                      {v.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.thumb} alt="" className="w-14 h-8 object-cover rounded shrink-0" />
                      ) : (
                        <div className="w-14 h-8 bg-muted rounded shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{v.title}</div>
                        <div className="text-micro text-muted-foreground">{fmt(v.views)} views · {fmt(v.likes)} likes · {fmt(v.comments)} comments</div>
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
      <div className="text-micro text-muted-foreground">{label}</div>
      <div className="text-base font-semibold mt-0.5 tabular-nums" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
