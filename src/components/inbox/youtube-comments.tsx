'use client';

import { useEffect, useState } from 'react';
import { Youtube, MessageSquare, Sparkles, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';

interface YTComment {
  id: string;
  video_id: string;
  author: string;
  author_thumb: string | null;
  text: string;
  published_at: string;
  like_count: number;
  reply_count: number;
}

// The Inbox's YouTube triage panel. Pulls newest top-level comments from the
// connected channel, lets the owner kick off a content-writer draft per
// comment, and surfaces a one-line confirmation when the draft is queued in
// /drafts (where Approve → publishContent → replyToComment posts the reply).
export function YouTubeCommentsPanel() {
  const [comments, setComments] = useState<YTComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  // Per-comment row state: 'drafting' while the agent runs, 'drafted' once the
  // draft lands in /drafts. Anything else means idle.
  const [rowState, setRowState] = useState<Record<string, 'idle' | 'drafting' | 'drafted'>>({});

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const r = await fetch('/api/integrations/youtube/comments?max=20', { cache: 'no-store' });
        const j = await r.json();
        if (cancel) return;
        setConnected(!!j.connected);
        if (j.error) setError(j.error);
        else setError(null);
        setComments(Array.isArray(j.comments) ? j.comments : []);
      } catch (e) {
        if (!cancel) setError((e as Error).message);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();
    // Re-poll every 2 minutes — YouTube comments are not real-time and the
    // free-tier quota is finite.
    const t = setInterval(load, 120_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  const draftReply = async (c: YTComment) => {
    setRowState((s) => ({ ...s, [c.id]: 'drafting' }));
    try {
      const r = await fetch(`/api/integrations/youtube/comments/${encodeURIComponent(c.id)}/draft-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment_text: c.text, author: c.author, video_id: c.video_id,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Draft failed (${r.status})`);
      }
      setRowState((s) => ({ ...s, [c.id]: 'drafted' }));
    } catch (e) {
      setRowState((s) => ({ ...s, [c.id]: 'idle' }));
      setError((e as Error).message);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Youtube size={14} className="text-[#ff0033]" />
        <h3 className="section-title">YouTube comments</h3>
        <span className="text-micro text-muted-foreground">newest first · auto-refresh 2m</span>
      </div>
      <div className="panel-body space-y-2.5">
        {loading && comments.length === 0 ? (
          <div className="py-8 flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading comments…
          </div>
        ) : connected === false ? (
          <div className="py-6 text-center text-small">
            YouTube not connected for this tenant. Connect it in <a href="/connections" className="underline">Connections</a>.
          </div>
        ) : error ? (
          <div className="py-6 text-center text-small text-destructive">
            {error}
          </div>
        ) : comments.length === 0 ? (
          <div className="py-6 text-center text-small">No new comments to triage.</div>
        ) : (
          comments.map((c) => {
            const state = rowState[c.id] ?? 'idle';
            return (
              <div key={c.id} className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-3 flex items-start gap-3">
                {c.author_thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.author_thumb} alt={c.author} className="w-7 h-7 rounded-full shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-muted shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold truncate">{c.author}</span>
                    <span className="text-micro text-muted-foreground">{relTime(c.published_at)}</span>
                    {c.like_count > 0 && <span className="text-micro text-muted-foreground">· {c.like_count} 👍</span>}
                    {c.reply_count > 0 && <span className="text-micro text-muted-foreground">· {c.reply_count} replies</span>}
                    <a
                      href={`https://www.youtube.com/watch?v=${c.video_id}&lc=${c.id}`}
                      target="_blank" rel="noreferrer"
                      className="text-micro text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 ml-auto"
                    >
                      open <ExternalLink size={10} />
                    </a>
                  </div>
                  <div className="text-xs mt-1 whitespace-pre-wrap leading-relaxed line-clamp-4">{c.text}</div>
                  <div className="mt-2">
                    {state === 'drafted' ? (
                      <a
                        href="/drafts"
                        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--primary)]"
                      >
                        <CheckCircle2 size={12} /> Draft queued · open Drafts to approve
                      </a>
                    ) : state === 'drafting' ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Loader2 size={12} className="animate-spin" /> Drafting reply…
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => draftReply(c)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded px-2 py-1 border border-border/60 hover:bg-muted/30"
                        title="content-writer drafts a reply → lands in /drafts pending your approval"
                      >
                        <Sparkles size={11} /> Draft reply
                      </button>
                    )}
                  </div>
                </div>
                <MessageSquare size={13} className="text-muted-foreground/40 shrink-0 mt-0.5" />
              </div>
            );
          })
        )}
      </div>
    </div>
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
  return `${Math.floor(s / 86400)}d ago`;
}
