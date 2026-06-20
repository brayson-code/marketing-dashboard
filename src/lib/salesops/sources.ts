// sources.ts — Playbook Studio (Phase 2): manage the EVIDENCE the Reanalyze loop reads.
//
// A "source" is one piece of evidence the rep adds to re-derive their active playbook from:
//   - won_call   : one of the rep's OWN closed-won calls (a sales_calls.id) → content =
//                  transcript + summary (whichever exist), re-read tenant-scoped by id.
//   - instagram  : a creator's handle OR a single reel/post URL → scraped via src/lib/apify.ts
//                  (scrapeProfileReels for a handle, scrapeReel for a URL); content = captions
//                  (+ any subtitle/transcript text the actor returns).
//   - youtube    : SLICE 1 — pasted text only (native transcript auto-fetch is DEFERRED; no new
//                  scraping dependency). content = the pasted body.text.
//   - manual     : freeform pasted notes. content = the pasted body.text.
//
// Every function here is TENANT-SCOPED: each query filters on tenantId() as a tagged-template
// param (never string-interpolated), exactly like the salesops-admin routes. These are pure
// data helpers — the route does auth + flag gating; this module assumes it already ran under
// enterTenant(resolveTenant()).
//
// Extraction is SYNCHRONOUS on create (per the Phase-2 contract): create the row 'pending',
// extract, then flip to 'extracted' (+content) or 'error' (+error). The Anthropic/Apify BYO-key
// contract is upheld upstream: instagram extraction throws CONNECT_APIFY when no Apify key is
// connected so the route can return 400 {error:'connect_apify'} BEFORE scraping.

import { sql, tenantId, jsonb } from '@/lib/db/client';
import { currentUserId } from '@/lib/tenant';
import {
  getApifyKey,
  scrapeReel,
  scrapeProfileReels,
  type ReelData,
} from '@/lib/apify';

/** Thrown when instagram extraction is attempted with no Apify key connected for this tenant.
 *  The route maps this exact message to 400 {error:'connect_apify'} (BYO-key contract). */
export const CONNECT_APIFY = 'connect_apify';

export type SourceKind = 'won_call' | 'instagram' | 'youtube' | 'manual';
export type SourceStatus = 'pending' | 'extracted' | 'error';

/** A row of salesops_playbook_sources, as the routes/UI consume it. */
export interface SourceRecord {
  id: string;
  tenant_id: string;
  kind: SourceKind;
  label: string | null;
  ref: string | null;
  niche: string | null;
  status: SourceStatus;
  content: string | null;
  metadata: Record<string, unknown>;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Input to createSource — what the POST /sources route hands in. */
export interface CreateSourceInput {
  kind: SourceKind;
  ref?: string | null; // sales_calls.id (won_call) | handle/url (instagram/youtube)
  label?: string | null;
  niche?: string | null;
  text?: string | null; // pasted body for youtube/manual (Slice 1)
}

// ── helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

/** Coerce a DB row (postgres.js returns jsonb already-parsed) to a typed SourceRecord. */
function toRecord(row: Record<string, unknown>): SourceRecord {
  const meta = row.metadata;
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    kind: row.kind as SourceKind,
    label: (row.label as string | null) ?? null,
    ref: (row.ref as string | null) ?? null,
    niche: (row.niche as string | null) ?? null,
    status: row.status as SourceStatus,
    content: (row.content as string | null) ?? null,
    metadata: meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {},
    error: (row.error as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

/** List this tenant's sources, newest first. */
export async function listSources(): Promise<SourceRecord[]> {
  const s = sql();
  const rows = (await s`
    SELECT id, tenant_id, kind, label, ref, niche, status, content, metadata, error,
           created_by, created_at, updated_at
    FROM salesops_playbook_sources
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC
  `) as unknown as Record<string, unknown>[];
  return rows.map(toRecord);
}

/** Fetch one source by id (tenant-scoped), or null. */
export async function getSource(id: string): Promise<SourceRecord | null> {
  const s = sql();
  const rows = (await s`
    SELECT id, tenant_id, kind, label, ref, niche, status, content, metadata, error,
           created_by, created_at, updated_at
    FROM salesops_playbook_sources
    WHERE id = ${id} AND tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as Record<string, unknown>[];
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Delete a source (tenant-scoped). Returns true if a row was removed. */
export async function deleteSource(id: string): Promise<boolean> {
  const s = sql();
  const rows = (await s`
    DELETE FROM salesops_playbook_sources
    WHERE id = ${id} AND tenant_id = ${tenantId()}
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/** Only the EXTRACTED sources for this tenant (optionally a subset of ids) — what the
 *  Reanalyze run feeds the model. content is guaranteed non-empty (contentless rows dropped). */
export async function listExtractedSources(ids?: string[]): Promise<SourceRecord[]> {
  const s = sql();
  const subset = ids?.filter(Boolean) ?? null;
  const rows =
    subset && subset.length
      ? ((await s`
          SELECT id, tenant_id, kind, label, ref, niche, status, content, metadata, error,
                 created_by, created_at, updated_at
          FROM salesops_playbook_sources
          WHERE tenant_id = ${tenantId()}
            AND status = 'extracted'
            AND id = ANY(${subset})
          ORDER BY created_at DESC
        `) as unknown as Record<string, unknown>[])
      : ((await s`
          SELECT id, tenant_id, kind, label, ref, niche, status, content, metadata, error,
                 created_by, created_at, updated_at
          FROM salesops_playbook_sources
          WHERE tenant_id = ${tenantId()}
            AND status = 'extracted'
          ORDER BY created_at DESC
        `) as unknown as Record<string, unknown>[]);
  // Guard against an 'extracted' row with empty content (shouldn't happen, but the analyzer
  // must never receive a contentless source).
  return rows.map(toRecord).filter((r) => str(r.content).length > 0);
}

/**
 * Create a source AND extract its content synchronously, returning the final row.
 * On extraction success → status 'extracted' + content. On failure → status 'error' + error.
 * @throws Error(CONNECT_APIFY) when kind='instagram' and no Apify key is connected (so the
 *         route can return 400 {error:'connect_apify'} without leaving a half-row — we check
 *         the key BEFORE inserting).
 */
export async function createSource(input: CreateSourceInput): Promise<SourceRecord> {
  const kind = input.kind;
  const ref = str(input.ref) || null;
  const label = str(input.label) || null;
  const niche = str(input.niche) || null;
  const pastedText = str(input.text);

  // Pre-flight the Apify BYO-key check so the route can fail cleanly BEFORE we insert a row.
  if (kind === 'instagram') {
    const key = await getApifyKey();
    if (!key) throw new Error(CONNECT_APIFY);
  }

  const s = sql();
  const uid = currentUserId();
  const inserted = (await s`
    INSERT INTO salesops_playbook_sources (tenant_id, kind, label, ref, niche, status, created_by)
    VALUES (${tenantId()}, ${kind}, ${label}, ${ref}, ${niche}, 'pending', ${uid})
    RETURNING id, tenant_id, kind, label, ref, niche, status, content, metadata, error,
              created_by, created_at, updated_at
  `) as unknown as Record<string, unknown>[];
  const row = toRecord(inserted[0]);

  // Extract, then persist the outcome. Any failure → status 'error' + the message (never throws
  // out of here EXCEPT the pre-insert CONNECT_APIFY above).
  try {
    const { content, metadata } = await extractContent(kind, ref, pastedText);
    if (!content) {
      return await markError(row.id, 'no_content_extracted');
    }
    return await markExtracted(row.id, content, metadata);
  } catch (e) {
    return await markError(row.id, (e as Error)?.message ?? 'extraction_failed');
  }
}

// ── status transitions (tenant-scoped) ────────────────────────────────────────

async function markExtracted(
  id: string,
  content: string,
  metadata: Record<string, unknown>,
): Promise<SourceRecord> {
  const s = sql();
  const rows = (await s`
    UPDATE salesops_playbook_sources
    SET status = 'extracted', content = ${content}, metadata = ${jsonb(metadata)},
        error = null, updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
    RETURNING id, tenant_id, kind, label, ref, niche, status, content, metadata, error,
              created_by, created_at, updated_at
  `) as unknown as Record<string, unknown>[];
  return toRecord(rows[0]);
}

async function markError(id: string, error: string): Promise<SourceRecord> {
  const s = sql();
  const rows = (await s`
    UPDATE salesops_playbook_sources
    SET status = 'error', error = ${error.slice(0, 500)}, updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
    RETURNING id, tenant_id, kind, label, ref, niche, status, content, metadata, error,
              created_by, created_at, updated_at
  `) as unknown as Record<string, unknown>[];
  return toRecord(rows[0]);
}

// ── extraction ────────────────────────────────────────────────────────────────

interface Extracted {
  content: string;
  metadata: Record<string, unknown>;
}

/** Dispatch extraction by kind. Returns the text the analyzer reads + provenance metadata.
 *  Throws on a hard failure (e.g. won_call ref not found, Apify scrape error) — the caller
 *  catches and records status='error'. */
async function extractContent(
  kind: SourceKind,
  ref: string | null,
  pastedText: string,
): Promise<Extracted> {
  switch (kind) {
    case 'won_call':
      return extractWonCall(ref);
    case 'instagram':
      return extractInstagram(ref);
    case 'youtube':
    case 'manual':
      // Slice 1: persist pasted text as-is. (YouTube native transcript auto-fetch DEFERRED —
      // no new scraping dependency; the rep pastes the transcript/notes.)
      return { content: pastedText, metadata: { kind, mode: 'pasted' } };
  }
}

/** won_call: ref is a sales_calls.id. content = transcript + "\n\n" + summary (those that exist). */
async function extractWonCall(ref: string | null): Promise<Extracted> {
  if (!ref) throw new Error('missing_call_ref');
  const s = sql();
  const rows = (await s`
    SELECT transcript, summary, contact_name, contact_email, deal_temp, started_at
    FROM sales_calls
    WHERE id = ${ref} AND tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as Array<{
    transcript: string | null;
    summary: string | null;
    contact_name: string | null;
    contact_email: string | null;
    deal_temp: string | null;
    started_at: string | null;
  }>;
  const call = rows[0];
  if (!call) throw new Error('call_not_found');
  const content = [str(call.transcript), str(call.summary)].filter(Boolean).join('\n\n');
  return {
    content,
    metadata: {
      kind: 'won_call',
      call_id: ref,
      contact_name: call.contact_name ?? null,
      contact_email: call.contact_email ?? null,
      deal_temp: call.deal_temp ?? null,
      started_at: call.started_at ?? null,
      has_transcript: Boolean(str(call.transcript)),
      has_summary: Boolean(str(call.summary)),
    },
  };
}

/** instagram: ref is a handle OR a single reel/post URL. content = caption (+ subtitles) text.
 *  A URL → scrapeReel (single). A handle → scrapeProfileReels (recent reels), joined. */
async function extractInstagram(ref: string | null): Promise<Extracted> {
  if (!ref) throw new Error('missing_instagram_ref');
  const isUrl = ref.includes('/') || ref.startsWith('http');
  const reelText = (r: ReelData): string =>
    [str(r.caption), str(r.subtitles)].filter(Boolean).join('\n');

  if (isUrl) {
    const reel = await scrapeReel(ref); // throws if private/removed → caller marks error
    const content = [str(reel.caption), str(reel.subtitles)].filter(Boolean).join('\n\n');
    return {
      content,
      metadata: { kind: 'instagram', mode: 'url', url: reel.url, handle: reel.handle ?? null },
    };
  }

  const reels = await scrapeProfileReels(ref, 12); // [] (no throw) for private/empty
  const content = reels
    .map(reelText)
    .filter(Boolean)
    .join('\n\n---\n');
  return {
    content,
    metadata: {
      kind: 'instagram',
      mode: 'handle',
      handle: ref.replace(/^@/, ''),
      reel_count: reels.length,
    },
  };
}
