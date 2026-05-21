// CRUD for the `documents` table — the editable "second brain" of markdown
// knowledge files (the cloud replacement for on-disk .md files). Backend uses
// the postgres role (bypasses RLS) so every query scopes to DEFAULT_TENANT_ID.

import { sql, DEFAULT_TENANT_ID } from './db/client';

export type DocStatus = 'raw' | 'wiki' | 'archived';

export interface DocRow {
  id: string;
  type: string;
  title: string;
  content: string;
  status: DocStatus;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocListItem {
  id: string;
  type: string;
  title: string;
  status: DocStatus;
  version: number;
  updated_at: string;
  excerpt: string;
}

export async function listDocuments(): Promise<DocListItem[]> {
  const rows = (await sql()`
    SELECT id, type, title, status, version, updated_at, left(content, 160) AS excerpt
    FROM public.documents
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY updated_at DESC
    LIMIT 500
  `) as unknown as DocListItem[];
  return rows;
}

export async function getDocument(id: string): Promise<DocRow | null> {
  const rows = (await sql()`
    SELECT * FROM public.documents WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `) as unknown as DocRow[];
  return rows[0] ?? null;
}

export async function createDocument(input: { title: string; content?: string; type?: string; status?: DocStatus }): Promise<DocRow> {
  const rows = (await sql()`
    INSERT INTO public.documents (tenant_id, type, title, content, status, created_by)
    VALUES (
      ${DEFAULT_TENANT_ID}, ${input.type ?? 'note'}, ${input.title},
      ${input.content ?? ''}, ${input.status ?? 'raw'}, 'owner'
    )
    RETURNING *
  `) as unknown as DocRow[];
  return rows[0];
}

export async function updateDocument(
  id: string,
  fields: { title?: string; content?: string; status?: DocStatus; type?: string },
): Promise<DocRow | null> {
  const rows = (await sql()`
    UPDATE public.documents SET
      title   = COALESCE(${fields.title ?? null}, title),
      content = COALESCE(${fields.content ?? null}, content),
      status  = COALESCE(${fields.status ?? null}, status),
      type    = COALESCE(${fields.type ?? null}, type),
      version = version + 1,
      updated_at = now()
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
    RETURNING *
  `) as unknown as DocRow[];
  return rows[0] ?? null;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const rows = (await sql()`
    DELETE FROM public.documents WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID} RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}
