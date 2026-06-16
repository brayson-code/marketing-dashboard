// Persistence for the Hyperframes node canvas — the React Flow graph (nodes/edges/
// viewport) per tenant. Mirrors the standard tenant-scoped sql() pattern.

import { sql, jsonb, tenantId } from './db/client';

export interface CanvasNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  [k: string]: unknown;
}
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  [k: string]: unknown;
}
export interface GenerationCanvasRow {
  id: number;
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number } | null;
  draft_id: number | null;
  created_at: string;
  updated_at: string;
}

export async function listCanvases(): Promise<Array<{ id: number; title: string; updated_at: string }>> {
  return (await sql()`
    SELECT id, title, updated_at FROM public.generation_canvas
    WHERE tenant_id = ${tenantId()} ORDER BY updated_at DESC LIMIT 100
  `) as unknown as Array<{ id: number; title: string; updated_at: string }>;
}

export async function getCanvas(id: number): Promise<GenerationCanvasRow | null> {
  const rows = (await sql()`
    SELECT id, title, nodes, edges, viewport, draft_id, created_at, updated_at
    FROM public.generation_canvas WHERE id = ${id} AND tenant_id = ${tenantId()}
  `) as unknown as GenerationCanvasRow[];
  return rows[0] ?? null;
}

export async function createCanvas(title?: string): Promise<GenerationCanvasRow> {
  const rows = (await sql()`
    INSERT INTO public.generation_canvas (tenant_id, title, nodes, edges)
    VALUES (${tenantId()}, ${title?.trim() || 'Untitled canvas'}, '[]'::jsonb, '[]'::jsonb)
    RETURNING id, title, nodes, edges, viewport, draft_id, created_at, updated_at
  `) as unknown as GenerationCanvasRow[];
  return rows[0];
}

export async function saveCanvas(
  id: number,
  patch: { title?: string; nodes?: CanvasNode[]; edges?: CanvasEdge[]; viewport?: unknown },
): Promise<void> {
  await sql()`
    UPDATE public.generation_canvas SET
      title    = COALESCE(${patch.title ?? null}, title),
      nodes    = COALESCE(${patch.nodes ? jsonb(patch.nodes) : null}, nodes),
      edges    = COALESCE(${patch.edges ? jsonb(patch.edges) : null}, edges),
      viewport = COALESCE(${patch.viewport ? jsonb(patch.viewport) : null}, viewport),
      updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
}
