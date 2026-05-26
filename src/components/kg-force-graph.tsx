'use client';

// Thin client-only wrapper around react-force-graph-2d, loaded via
// next/dynamic({ ssr: false }) so the canvas lib never runs on the server.
// next/dynamic doesn't reliably forward refs, so instead of a ref we hand the
// parent the live graph instance through an `onReady` callback (fired once, after
// the inner ForceGraph2D has mounted and its imperative methods exist). The parent
// uses it to call zoomToFit() — which is what centers the graph.

import { useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function KgForceGraph({ onReady, ...props }: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(undefined);
  const sent = useRef(false);
  useEffect(() => {
    if (ref.current && !sent.current && typeof onReady === 'function') {
      sent.current = true;
      onReady(ref.current);
    }
  });
  return <ForceGraph2D ref={ref} {...props} />;
}
