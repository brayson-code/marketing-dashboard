import { sql, tenantId } from './db/client';

// Per-tenant media library (a-roll / b-roll clips + images) for the Hyperframes
// studio. Files live in Vercel Blob; this records metadata + the public URL so
// the editor can list them and drop them onto scenes. Tenant-scoped throughout.

export interface AssetRow {
  id: number;
  kind: 'video' | 'image';
  name: string | null;
  url: string;
  pathname: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  source: string;
  created_at: number;
}

const COLS = `id, kind, name, url, pathname, size_bytes, duration_ms, source,
  extract(epoch from created_at)::bigint AS created_at`;

export async function listAssets(): Promise<AssetRow[]> {
  return (await sql().unsafe(
    `SELECT ${COLS} FROM tenant_assets WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId()],
  )) as unknown as AssetRow[];
}

export async function createAsset(a: {
  kind: 'video' | 'image';
  name?: string;
  url: string;
  pathname?: string;
  sizeBytes?: number;
  durationMs?: number;
  source?: 'upload' | 'ai' | 'movie-clip';
}): Promise<AssetRow> {
  const rows = (await sql().unsafe(
    `INSERT INTO tenant_assets (tenant_id, kind, name, url, pathname, size_bytes, duration_ms, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${COLS}`,
    [tenantId(), a.kind, a.name ?? null, a.url, a.pathname ?? null, a.sizeBytes ?? null, a.durationMs ?? null, a.source ?? 'upload'],
  )) as unknown as AssetRow[];
  return rows[0];
}

/** Delete the row, returning its blob pathname so the caller can purge the file. */
export async function deleteAsset(id: number): Promise<string | null> {
  const rows = (await sql()`
    DELETE FROM tenant_assets WHERE id = ${id} AND tenant_id = ${tenantId()}
    RETURNING pathname
  `) as unknown as { pathname: string | null }[];
  return rows[0]?.pathname ?? null;
}
