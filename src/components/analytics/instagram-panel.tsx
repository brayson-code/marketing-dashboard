'use client';

import { useEffect, useState } from 'react';
import { Instagram, Loader2, ExternalLink } from 'lucide-react';

interface IGAccount {
  ig_user_id: string;
  username: string;
  name: string | null;
  profile_picture: string | null;
  media_count: number;
  followers_count: number;
  follows_count: number;
}

interface IGInsights {
  start: string;
  end: string;
  reach: number;
  views: number;
  followers_gained: number;
}

interface IGMedia {
  id: string;
  media_type: string;
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string;
  caption: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
}

// Instagram panel on /analytics. Account headline + last-30d insights +
// most-recent media grid. All three endpoints degrade to "not connected"
// so the panel renders a helpful empty state instead of crashing.
export function InstagramPanel() {
  const [account, setAccount] = useState<IGAccount | null>(null);
  const [insights, setInsights] = useState<IGInsights | null>(null);
  const [media, setMedia] = useState<IGMedia[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const [s, ins, m] = await Promise.all([
          fetch('/api/integrations/instagram/stats', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
          fetch('/api/integrations/instagram/insights', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
          fetch('/api/integrations/instagram/media?max=6', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        ]);
        if (cancel) return;
        setConnected(!!s?.connected);
        if (s?.error) setError(s.error);
        setAccount(s?.account ?? null);
        setInsights(ins?.insights ?? null);
        setMedia(Array.isArray(m?.media) ? m.media : []);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();
    // Refresh every 5 minutes — IG insights update slowly + the Graph API has rate limits.
    const t = setInterval(load, 5 * 60_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Instagram size={14} className="text-[#e1306c]" />
        <h3 className="section-title">Instagram</h3>
        {account?.username && (
          <a
            href={`https://www.instagram.com/${account.username}`}
            target="_blank" rel="noreferrer"
            className="ml-auto text-micro text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
          >
            @{account.username} <ExternalLink size={10} />
          </a>
        )}
      </div>
      <div className="panel-body space-y-3">
        {loading ? (
          <div className="py-6 flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading account…
          </div>
        ) : connected === false ? (
          <div className="py-6 text-center text-small space-y-1">
            <div>Instagram not connected. <a href="/connections" className="underline">Connect</a> to surface stats here.</div>
            <div className="text-micro text-muted-foreground">Requires a Business or Creator account linked to a Facebook Page.</div>
          </div>
        ) : error ? (
          <div className="py-6 text-center text-small text-destructive">{error}</div>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              {account?.profile_picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={account.profile_picture} alt="" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-muted" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{account?.name || account?.username || 'Account'}</div>
                <div className="text-micro text-muted-foreground truncate">@{account?.username}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="Followers" value={fmt(account?.followers_count ?? 0)} />
              <Stat label="Following" value={fmt(account?.follows_count ?? 0)} />
              <Stat label="Media" value={fmt(account?.media_count ?? 0)} />
            </div>

            {insights ? (
              <div>
                <div className="text-micro text-muted-foreground mb-1">Last 30 days · {insights.start} → {insights.end}</div>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Reach" value={fmt(insights.reach)} accent="var(--primary)" />
                  <Stat label="Views" value={fmt(insights.views)} />
                  <Stat
                    label="Net followers"
                    value={(insights.followers_gained > 0 ? '+' : '') + fmt(insights.followers_gained)}
                    accent={insights.followers_gained > 0 ? 'var(--primary)' : insights.followers_gained < 0 ? 'var(--destructive)' : undefined}
                  />
                </div>
              </div>
            ) : (
              <div className="text-micro text-muted-foreground">No insights yet — Business/Creator account required for reach + views.</div>
            )}

            <div>
              <div className="text-micro text-muted-foreground mb-1.5">Recent posts</div>
              {media.length === 0 ? (
                <div className="text-small py-3 text-center">No recent posts.</div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {media.map((m) => (
                    <a
                      key={m.id}
                      href={m.permalink}
                      target="_blank" rel="noreferrer"
                      className="relative aspect-square rounded-md overflow-hidden bg-muted hover:opacity-80"
                      style={{ transition: 'opacity var(--t-popover, 160ms) var(--ease-out, ease-out)' }}
                      title={m.caption?.slice(0, 80) || m.media_type}
                    >
                      {m.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-muted" />
                      )}
                      <div className="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[10px] tabular-nums bg-black/45 text-white flex justify-between">
                        <span>{fmt(m.like_count)} likes</span>
                        <span>{fmt(m.comments_count)} cmt</span>
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
