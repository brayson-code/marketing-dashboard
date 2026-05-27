// CRUD for the `documents` table — the editable "second brain" of markdown
// knowledge files (the cloud replacement for on-disk .md files). Backend uses
// the postgres role (bypasses RLS) so every query scopes to tenantId().

import { sql, tenantId } from './db/client';

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
    WHERE tenant_id = ${tenantId()}
    ORDER BY updated_at DESC
    LIMIT 500
  `) as unknown as DocListItem[];
  return rows;
}

export async function getDocument(id: string): Promise<DocRow | null> {
  const rows = (await sql()`
    SELECT * FROM public.documents WHERE id = ${id} AND tenant_id = ${tenantId()}
  `) as unknown as DocRow[];
  return rows[0] ?? null;
}

export async function createDocument(input: { title: string; content?: string; type?: string; status?: DocStatus }): Promise<DocRow> {
  const rows = (await sql()`
    INSERT INTO public.documents (tenant_id, type, title, content, status, created_by)
    VALUES (
      ${tenantId()}, ${input.type ?? 'note'}, ${input.title},
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
    WHERE id = ${id} AND tenant_id = ${tenantId()}
    RETURNING *
  `) as unknown as DocRow[];
  return rows[0] ?? null;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const rows = (await sql()`
    DELETE FROM public.documents WHERE id = ${id} AND tenant_id = ${tenantId()} RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

export async function findDocumentByTitle(title: string): Promise<DocRow | null> {
  const rows = (await sql()`
    SELECT * FROM public.documents
    WHERE tenant_id = ${tenantId()} AND lower(title) = lower(${title})
    ORDER BY updated_at DESC LIMIT 1
  `) as unknown as DocRow[];
  return rows[0] ?? null;
}

// Cap on a rolling auto-updated doc so cron output can't grow it unbounded.
const KB_DOC_MAX_CHARS = 60_000;

/**
 * Prepend a dated section to a knowledge-base document (newest first),
 * creating the doc if it doesn't exist. Used by the cron runner to persist
 * agent output where the email/sales agents (and the owner) can reuse it.
 */
export async function appendKnowledgeSection(title: string, heading: string, body: string): Promise<string> {
  const section = `## ${heading}\n\n${body.trim()}\n`;
  const existing = await findDocumentByTitle(title);

  if (!existing) {
    const doc = await createDocument({
      title,
      type: 'note',
      status: 'raw',
      content: `# ${title}\n\n_Auto-updated by KeyPlayer cron. Newest entries first._\n\n${section}`,
    });
    return doc.id;
  }

  const content = existing.content || `# ${title}\n`;
  const firstSection = content.indexOf('\n## ');
  let next =
    firstSection >= 0
      ? content.slice(0, firstSection + 1) + section + '\n' + content.slice(firstSection + 1)
      : `${content.replace(/\s*$/, '')}\n\n${section}`;
  if (next.length > KB_DOC_MAX_CHARS) {
    next = next.slice(0, KB_DOC_MAX_CHARS).replace(/\n[^\n]*$/, '') + '\n\n_(older entries trimmed)_\n';
  }
  await updateDocument(existing.id, { content: next });
  return existing.id;
}
