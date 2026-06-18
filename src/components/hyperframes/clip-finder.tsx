'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2, Plus, Check, Film, Volume2 } from 'lucide-react';
import { toast } from '@/components/ui/toast';

// Movie-clip finder: type a phrase → see real movie/TV clips → PLAY them inline
// (streamed straight from PlayPhrase's open S3, no download) → "Add" to import the
// clip into the media library (download → Blob → tenant_assets), where it becomes
// usable as a Hyperframes scene clip. Hidden unless MOVIE_CLIPS_ENABLED (surfaced
// via /api/auth/me.movie_clips_enabled).

interface MovieClip {
  id: string;
  text: string;
  movie: string;
  videoUrl: string;
}

export function ClipFinder({ onImported }: { onImported?: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [phrase, setPhrase] = useState('');
  const [count, setCount] = useState(8);
  const [clips, setClips] = useState<MovieClip[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [cached, setCached] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setEnabled(Boolean(d?.movie_clips_enabled)))
      .catch(() => setEnabled(false));
  }, []);

  const search = useCallback(async () => {
    const q = phrase.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch('/api/clips/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase: q, count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Search failed');
      setClips(data.clips || []);
      setCached(Boolean(data.cached));
    } catch (e) {
      toast.error((e as Error).message);
      setClips([]);
    } finally {
      setLoading(false);
    }
  }, [phrase, count]);

  const add = useCallback(
    async (clip: MovieClip) => {
      setImporting(clip.id);
      try {
        const res = await fetch('/api/clips/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: clip.videoUrl, text: clip.text, movie: clip.movie }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Import failed');
        setDone((s) => new Set(s).add(clip.id));
        toast.success('Added to media library');
        onImported?.();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setImporting(null);
      }
    },
    [onImported],
  );

  if (enabled === false) return null; // feature off — render nothing

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Film size={15} className="text-primary" />
        <h3 className="section-title">Movie clips</h3>
        <span className="text-[11px] text-muted ml-1">search a quote → preview → add as b-roll</span>
      </div>
      <div className="panel-body space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder='e.g. "I am your father"'
              className="input input-sm w-full pl-8"
              maxLength={120}
            />
          </div>
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="px-2 text-sm"
            title="How many clips to return"
            aria-label="Number of results"
          >
            {[4, 8, 12].map((n) => <option key={n} value={n}>{n} results</option>)}
          </select>
          <button type="submit" className="btn btn-primary btn-sm" disabled={loading || !phrase.trim()}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Search
          </button>
        </form>

        {loading && (
          <p className="text-xs text-muted flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Finding clips…
          </p>
        )}

        {!loading && searched && clips.length === 0 && (
          <p className="text-xs text-muted">No clips found for that phrase. Try a shorter, more common line.</p>
        )}

        {clips.length > 0 && (
          <>
            {cached && <p className="text-[11px] text-muted">⚡ instant (cached)</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {clips.map((c) => (
                <ClipCard
                  key={c.id}
                  clip={c}
                  importing={importing === c.id}
                  added={done.has(c.id)}
                  onAdd={() => add(c)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ClipCard({
  clip, importing, added, onAdd,
}: {
  clip: MovieClip;
  importing: boolean;
  added: boolean;
  onAdd: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <div className="rounded-lg border border-default overflow-hidden bg-surface-2 flex flex-col">
      {/* Preview streams directly from PlayPhrase's S3 — no download until "Add". */}
      <video
        ref={videoRef}
        src={clip.videoUrl}
        controls
        preload="metadata"
        playsInline
        className="w-full aspect-video bg-black object-contain"
      />
      <div className="p-2.5 flex flex-col gap-1.5 flex-1">
        <p className="text-[13px] leading-snug line-clamp-2" title={clip.text}>
          “{clip.text}”
        </p>
        {clip.movie && (
          <p className="text-[11px] text-muted flex items-center gap-1 truncate" title={clip.movie}>
            <Volume2 size={11} className="shrink-0" /> {clip.movie}
          </p>
        )}
        <button
          onClick={onAdd}
          disabled={importing || added}
          className={`btn btn-sm mt-auto ${added ? 'btn-ghost text-primary' : 'btn-secondary'}`}
        >
          {added ? (
            <><Check size={14} /> Added</>
          ) : importing ? (
            <><Loader2 size={14} className="animate-spin" /> Adding…</>
          ) : (
            <><Plus size={14} /> Add to library</>
          )}
        </button>
      </div>
    </div>
  );
}
