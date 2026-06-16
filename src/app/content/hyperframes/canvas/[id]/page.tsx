'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, ArrowLeft } from 'lucide-react';

// React Flow needs the DOM — load the board client-only.
const CanvasBoard = dynamic(
  () => import('@/components/hyperframes/canvas/canvas-board').then((m) => m.CanvasBoard),
  { ssr: false, loading: () => <div className="h-[60vh] grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div> },
);

interface CanvasData {
  id: number;
  title: string;
  nodes: unknown[];
  edges: unknown[];
  viewport: { x: number; y: number; zoom: number } | null;
}

export default function CanvasPage() {
  const params = useParams();
  const id = Number(params?.id);
  const [canvas, setCanvas] = useState<CanvasData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) { setError('Invalid canvas'); return; }
    fetch(`/api/generation/canvas/${id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (j.error) setError(j.error); else setCanvas(j.canvas); })
      .catch((e) => setError(String(e)));
  }, [id]);

  return (
    <div className="space-y-4 animate-in">
      <Link href="/content/hyperframes" className="btn btn-ghost btn-sm w-fit"><ArrowLeft size={12} /> Hyperframes</Link>
      {error ? (
        <div className="panel p-6 text-destructive text-sm">{error}</div>
      ) : !canvas ? (
        <div className="h-[60vh] grid place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          <h1 className="text-h1">{canvas.title}</h1>
          <CanvasBoard
            canvasId={id}
            initialNodes={(canvas.nodes as never) ?? []}
            initialEdges={(canvas.edges as never) ?? []}
            initialViewport={canvas.viewport}
            title={canvas.title}
          />
        </>
      )}
    </div>
  );
}
