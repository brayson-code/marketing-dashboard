// Active-documents context — makes the Reports tab's "Active" docs agent-readable.
//
// Documents (public.documents) are NOT read by any agent today; the only standing
// business context injected into every agent prompt is the company playbook via
// companyContextBlock(). This module does the same job for documents the owner has
// marked Active (status = 'wiki'): it renders them into one markdown block that the
// orchestrator + every sub-agent prepend as long-term context.
//
// So status = 'wiki' now MEANS "Active — read by agents". Everything is tenant-scoped
// via tenantId() (sql() bypasses RLS). Returns '' when there are no active docs, so
// there is zero prompt/token cost until the owner activates something. Never throws —
// a context-load failure must never break an agent run.

import { sql, tenantId } from './db/client';

// Character budget for the whole active-documents section. Docs are added newest
// first until this is reached; a doc that would overflow is truncated, and any docs
// after the cap are dropped (with a note). ~8000 chars keeps standing SOPs affordable.
const BUDGET_CHARS = 8000;
const TRUNC_MARK = '…(truncated)';
const HEADER = '# Company knowledge & SOPs (standing procedures — follow these in everything you do)\n\n';
const OMITTED_NOTE = '\n\n_(additional active documents omitted for length)_';
const JOINER = '\n\n';

interface WikiDocRow {
  title: string;
  content: string;
  type: string;
  updated_at: string;
}

/**
 * A ready-to-prepend system-prompt block of the tenant's Active documents
 * (status = 'wiki'), newest first, capped at ~8000 characters. Returns '' when
 * there are no active docs (nothing injected → zero cost when unused). Best-effort:
 * any failure resolves to '' so it can never break an agent run.
 */
export async function companyKnowledgeBlock(): Promise<string> {
  try {
    const rows = (await sql()`
      SELECT title, content, type, updated_at
      FROM public.documents
      WHERE tenant_id = ${tenantId()} AND status = 'wiki'
      ORDER BY updated_at DESC
    `) as unknown as WikiDocRow[];

    if (!rows.length) return '';

    // Strict ceiling: BUDGET_CHARS bounds the ENTIRE returned block. We seed `used`
    // with the header, count each joiner, and reserve room for the omitted-note so
    // the final string can never exceed BUDGET_CHARS.
    const parts: string[] = [];
    let used = HEADER.length;
    let skipped = false;

    for (let i = 0; i < rows.length; i++) {
      const doc = rows[i];
      // Reserve space for the omitted-note in case we have to stop here.
      const remaining = BUDGET_CHARS - used - OMITTED_NOTE.length;
      const joiner = parts.length ? JOINER.length : 0;
      if (remaining - joiner <= 0) {
        skipped = true;
        break;
      }

      const heading = `## ${(doc.title || 'Untitled').trim()}\n`;
      const body = (doc.content || '').trim();
      const entry = `${heading}${body}`;

      if (joiner + entry.length <= remaining) {
        parts.push(entry);
        used += joiner + entry.length;
        continue;
      }

      // This doc overflows: include a truncated head, then stop.
      const avail = remaining - joiner - heading.length - TRUNC_MARK.length;
      if (avail > 0) {
        parts.push(`${heading}${body.slice(0, avail)}${TRUNC_MARK}`);
      }
      if (i < rows.length - 1 || avail <= 0) skipped = true;
      break;
    }

    if (!parts.length) return '';

    let block = HEADER + parts.join(JOINER);
    if (skipped) block += OMITTED_NOTE;
    return block;
  } catch {
    // Never let a context-load failure break an agent run.
    return '';
  }
}
