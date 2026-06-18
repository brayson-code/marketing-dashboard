'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderUp, Upload, Loader2, Trash2, ImageIcon, Video } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ContentTabs } from '@/components/content/content-tabs';
import { toast } from '@/components/ui/toast';

// Media library — the discoverable place clients drop their own footage (a-roll /
// b-roll clips + images). Stored per-tenant in Vercel Blob (see /api/assets); the
// Hyperframes editor's scene picker and the agent pull from the same library.
// No stock — tenant uploads (and AI-generated, later) only.

interface Asset {
  id: number; kind: 'video' | 'image'; name: string | null; url: string;
  size_bytes: number | null; created_at: number;
}

function fmtSize(n: number | null): string {
  if (!n) return '';
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export default function MediaLibraryPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [filter, setFilter] = useState<'all' | 'video' | 'image'>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch('/api/assets')
      .then((r) => r.json())
      .then((j) => { setAssets(j.assets || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading((u) => u + arr.length);
    await Promise.all(arr.map(async (f) => {
      try {
        const fd = new FormData();
        fd.append('file', f);
        const r = await fetch('/api/assets', { method: 'POST', body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'upload failed');
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      } finally {
        setUploading((u) => u - 1);
      }
    }));
    toast.success('Upload complete');
    load();
  }, [load]);

  const del = useCallback(async (id: number) => {
    if (!confirm('Delete this clip from your library?')) return;
    await fetch('/api/assets?id=' + id, { method: 'DELETE' });
    load();
  }, [load]);

  const shown = filter === 'all' ? assets : assets.filter((a) => a.kind === filter);

  return (
    <div className="space-y-5 animate-in">
      <PageHeader
        icon={<FolderUp size={18} />}
        title="Media library"
        subtitle="Drop your own footage here — a-roll, b-roll clips, and images. The Hyperframes editor and agents pull from this library to build your reels. No stock; your content only."
      />
      <ContentTabs />

      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="panel cursor-pointer flex flex-col items-center justify-center text-center py-12 border-2 border-dashed transition-colors"
        style={{
          borderColor: drag ? 'var(--primary)' : 'var(--border)',
          background: drag ? 'color-mix(in srgb, var(--primary) 7%, transparent)' : 'transparent',
        }}
      >
        {uploading > 0 ? (
          <><Loader2 className="animate-spin text-[var(--primary)]" size={24} /><p className="text-sm font-medium mt-2">Uploading {uploading} file{uploading > 1 ? 's' : ''}…</p></>
        ) : (
          <>
            <Upload size={24} className="text-[var(--primary)]" />
            <p className="text-sm font-medium mt-2">Drop clips here, or click to upload</p>
            <p className="text-xs text-muted-foreground mt-1">MP4 · MOV · images — a-roll, b-roll, brand assets</p>
          </>
        )}
        <input ref={inputRef} type="file" accept="video/*,image/*" multiple className="hidden"
          onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Filter */}
      <div className="flex gap-1">
        {(['all', 'video', 'image'] as const).map((f) => (
          <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'video' ? 'Clips' : 'Images'}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="panel"><div className="panel-body text-sm text-muted-foreground">No clips yet — drop your footage in the box above to start your library.</div></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {shown.map((a) => (
            <div key={a.id} className="panel overflow-hidden group relative">
              <div className="relative" style={{ aspectRatio: '9 / 16', background: '#111' }}>
                {a.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.name || ''} className="w-full h-full object-cover" />
                ) : (
                  // 9:16 framed (object-cover) so it previews exactly as it'll sit
                  // in a vertical reel; `controls` makes it play in place (was just
                  // a static first-frame before).
                  <video src={a.url} controls playsInline preload="metadata" className="w-full h-full object-cover" />
                )}
                <button onClick={() => del(a.id)} className="absolute top-1.5 right-1.5 btn btn-destructive btn-sm opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 size={12} />
                </button>
                <span className="absolute bottom-1.5 left-1.5 text-[9px] px-1.5 py-0.5 rounded bg-black/60 text-white flex items-center gap-1">
                  {a.kind === 'image' ? <ImageIcon size={9} /> : <Video size={9} />}{a.kind}
                </span>
              </div>
              <div className="p-2">
                <div className="text-[11px] truncate" title={a.name || ''}>{a.name || 'clip'}</div>
                <div className="text-[9px] text-muted-foreground">{fmtSize(a.size_bytes)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
