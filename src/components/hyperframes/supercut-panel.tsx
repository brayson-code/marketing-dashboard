'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, Loader2, Save, Wand2, Scissors } from 'lucide-react';
import { toast } from '@/components/ui/toast';

// Supercut: type a sentence → the server greedily plans which movie/TV clips cover
// which word-runs → the client fetches each clip cross-origin, trims + normalizes
// each segment with ffmpeg.wasm (single-threaded), concatenates them into one mp4,
// previews it, and uploads the result to the media library via POST /api/assets.
// NO server-side video processing. Hidden unless SUPERCUT_ENABLED (surfaced via
// /api/auth/me.supercut_enabled). ffmpeg deps are import()-ed lazily on the client
// only — they never enter a server bundle.

// Mirror of the server module's SupercutSegment (Part 1.1). The wire shape is
// identical; redeclared here because the client can't import the server module.
interface SupercutSegment {
  text: string; // the matched run (original-cased words joined by ' ')
  videoUrl: string; // source clip's open-S3 mp4 (CORS-fetchable)
  startMs: number; // trim start inside that clip
  endMs: number; // trim end inside that clip
  movie: string; // clip.movie, for attribution
}

// Single-threaded core (NOT core-mt) — no SharedArrayBuffer / COOP-COEP needed.
// Pinned to the build that pairs with the installed @ffmpeg/ffmpeg@0.12.x.
const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';

// Supercut MODE — rendered inside the Movie Clips panel when its "Supercut" tab is
// active. The parent ClipFinder owns the panel chrome + the supercut_enabled gate, so
// this is just the content (no panel wrapper, no flag fetch).
export function SupercutMode() {
  const [sentence, setSentence] = useState('');
  const [planning, setPlanning] = useState(false);
  const [segments, setSegments] = useState<SupercutSegment[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 overall
  const [stage, setStage] = useState(''); // human label
  const [resultUrl, setResultUrl] = useState<string | null>(null); // object URL of final mp4
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);

  // Keep the latest result URL in a ref so unmount cleanup always revokes it.
  const resultUrlRef = useRef<string | null>(null);
  useEffect(() => {
    resultUrlRef.current = resultUrl;
  }, [resultUrl]);
  useEffect(() => {
    return () => {
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  // Swap in a fresh result URL, revoking any prior one first.
  const setResult = useCallback((blob: Blob | null, url: string | null) => {
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setResultBlob(blob);
  }, []);

  // ── (a) Plan ───────────────────────────────────────────────────────────────
  const plan = useCallback(async () => {
    const s = sentence.trim();
    if (!s || planning || building) return;
    setPlanning(true);
    setSegments([]);
    setSkipped([]);
    setResult(null, null);
    setProgress(0);
    setStage('');
    try {
      const res = await fetch('/api/clips/supercut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: s }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Planning failed');
      const segs: SupercutSegment[] = data.segments ?? [];
      setSegments(segs);
      setSkipped(data.skipped ?? []);
      if (segs.length === 0) {
        toast.error('No clips matched — try simpler, more common words.');
      }
    } catch (e) {
      toast.error((e as Error).message);
      setSegments([]);
      setSkipped([]);
    } finally {
      setPlanning(false);
    }
  }, [sentence, planning, building, setResult]);

  // ── (b) Build (lazy-load ffmpeg, fetch, trim, concat) ────────────────────────
  const buildVideo = useCallback(async () => {
    if (building || segments.length === 0) return;
    setBuilding(true);
    setProgress(0);
    setStage('Loading engine…');
    setResult(null, null);

    try {
      // Lazy import — NEVER at module top level (keeps ffmpeg out of any server bundle).
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL, fetchFile } = await import('@ffmpeg/util');

      const ffmpeg = new FFmpeg();
      // segIndex is the current segment in the transcode loop; folded into the
      // overall bar. Concat is reserved as one extra "segment" worth of bar.
      let segIndex = 0;
      const totalSteps = segments.length + 1;
      ffmpeg.on('progress', ({ progress: p }) => {
        const clamped = Number.isFinite(p) ? Math.min(Math.max(p, 0), 1) : 0;
        setProgress(Math.min((segIndex + clamped) / totalSteps, 1));
      });

      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
        // NO workerURL → single-threaded core needs none.
      });

      // Per-segment transcode → uniform 720×1280, 30fps, 44.1kHz stereo AAC so the
      // cheap -c copy concat is valid (identical codec/res/SAR/fps/pixfmt/audio).
      for (let n = 0; n < segments.length; n++) {
        segIndex = n;
        const seg = segments[n];
        const inName = `in${n}.mp4`;
        const outName = `seg${n}.mp4`;
        const startSec = (seg.startMs / 1000).toFixed(3);
        const endSec = (seg.endMs / 1000).toFixed(3);

        setStage(`Trimming ${n + 1}/${segments.length}…`);
        let fileData: Uint8Array;
        try {
          fileData = await fetchFile(seg.videoUrl);
        } catch {
          throw new Error(`Couldn't fetch clip ${n + 1} (${seg.movie || seg.text}).`);
        }
        await ffmpeg.writeFile(inName, fileData);

        await ffmpeg.exec([
          '-ss', startSec,
          '-to', endSec,
          '-i', inName,
          '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30',
          '-ar', '44100',
          '-ac', '2',
          '-c:v', 'libx264',
          '-c:a', 'aac',
          outName,
        ]);
        await ffmpeg.deleteFile(inName); // free FS memory between segments
      }

      // Concat via the concat demuxer (stream copy, no re-encode).
      segIndex = segments.length;
      setStage('Stitching…');
      const list = segments.map((_, n) => `file 'seg${n}.mp4'`).join('\n') + '\n';
      await ffmpeg.writeFile('list.txt', new TextEncoder().encode(list));
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp4']);

      const data = await ffmpeg.readFile('out.mp4'); // Uint8Array for binary reads
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
      const blob = new Blob([bytes as BlobPart], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setResult(blob, url);
      setProgress(1);
      setStage('Done');

      // Best-effort FS cleanup so a second build stays cheap.
      try {
        await ffmpeg.deleteFile('out.mp4');
        await ffmpeg.deleteFile('list.txt');
        for (let n = 0; n < segments.length; n++) await ffmpeg.deleteFile(`seg${n}.mp4`);
      } catch {
        /* instance is GC'd anyway */
      }
    } catch (e) {
      toast.error((e as Error).message || 'Build failed');
      setStage('');
    } finally {
      setBuilding(false);
    }
  }, [building, segments, setResult]);

  // ── (c) Save to library ──────────────────────────────────────────────────────
  const saveToLibrary = useCallback(async () => {
    if (!resultBlob || saving) return;
    setSaving(true);
    try {
      const fd = new FormData();
      const file = new File([resultBlob], `supercut-${Date.now()}.mp4`, { type: 'video/mp4' });
      fd.append('file', file); // field name MUST be 'file' (per /api/assets)
      const res = await fetch('/api/assets', { method: 'POST', body: fd }); // browser sets multipart boundary
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      toast.success('Saved to media library');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [resultBlob, saving]);

  const busy = planning || building;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">Type a sentence → we find a movie/TV clip for each run of words and stitch them into one video.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            plan();
          }}
          className="space-y-2"
        >
          <textarea
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            placeholder="e.g. you talking to me, I am your father"
            rows={2}
            className="w-full text-sm resize-y"
            maxLength={280}
            disabled={building}
          />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted">
              We&apos;ll find a movie/TV clip for each run of words and stitch them together.
            </span>
            <button type="submit" className="btn btn-primary btn-sm ml-auto" disabled={busy || !sentence.trim()}>
              {planning ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              Plan supercut
            </button>
          </div>
        </form>

        {planning && (
          <p className="text-xs text-muted flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Planning the cut…
          </p>
        )}

        {segments.length > 0 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="section-title text-[11px]">{segments.length} segment{segments.length === 1 ? '' : 's'}</p>
              <ul className="space-y-1">
                {segments.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-default bg-surface-2 px-2.5 py-1.5 text-[13px]"
                  >
                    <Clapperboard size={12} className="shrink-0 text-muted" />
                    <span className="truncate" title={s.text}>“{s.text}”</span>
                    {s.movie && <span className="text-[11px] text-muted truncate ml-auto" title={s.movie}>{s.movie}</span>}
                    <span className="text-[11px] text-muted shrink-0 tabular-nums">
                      {((s.endMs - s.startMs) / 1000).toFixed(1)}s
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {skipped.length > 0 && (
              <p className="text-[11px] text-muted">
                Couldn&apos;t place: {skipped.join(', ')}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={buildVideo}
                disabled={busy || segments.length === 0}
                className="btn btn-primary btn-sm"
              >
                {building ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                Build video
              </button>
              {resultBlob && (
                <button
                  type="button"
                  onClick={saveToLibrary}
                  disabled={saving || building}
                  className="btn btn-secondary btn-sm"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save to library
                </button>
              )}
            </div>

            {building && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" /> {stage || 'Working…'}
                  </span>
                  <span className="tabular-nums">{Math.round(progress * 100)}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {resultUrl && (
              <video
                src={resultUrl}
                controls
                playsInline
                className="w-full aspect-[9/16] max-h-[70vh] bg-black object-contain rounded-lg"
              />
            )}
          </div>
        )}
    </div>
  );
}
