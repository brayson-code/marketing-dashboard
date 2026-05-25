'use client';

// Thin client-only wrapper around react-force-graph-2d. We load this via
// next/dynamic({ ssr: false }) from kg-graph.tsx so the canvas lib never runs on
// the server. The catch: next/dynamic does NOT forward React refs to the loaded
// component, so the parent could never call zoomToFit()/centerAt() — the graph
// never auto-centered. Here we accept the instance through a PLAIN prop (graphRef)
// and wire it to ForceGraph2D's own ref, which next/dynamic passes through fine.

import ForceGraph2D from 'react-force-graph-2d';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function KgForceGraph({ graphRef, ...props }: any) {
  return <ForceGraph2D ref={graphRef} {...props} />;
}
