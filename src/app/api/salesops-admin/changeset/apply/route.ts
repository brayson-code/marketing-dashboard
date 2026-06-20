// /api/salesops-admin/changeset/apply — SESSION-authed APPLY of a reanalyze change-set
// (Playbook Studio Phase 2). Owner accepts a subset of the proposed changes and names the
// result; we build a clean PlaybookContent off the change-set's BASE playbook, then take it
// through the EXACT same non-destructive path as playbook/apply: INSERT a NEW salesops_playbooks
// version (source='reanalyze') + flip is_active in ONE transaction + mirror the structured fields
// into salesops_config. We NEVER update/delete a prior playbook — every past version stays for
// history/split-testing. Finally we flip the change-set to 'applied' (+applied_playbook_id).
//
//   POST { changeset_id, accepted_indexes: number[], name } → { playbook: { id, name, is_active } }  [owner|member]
//
// Errors:
//   missing/invalid args        → 400
//   change-set not found        → 404 {error:'changeset_not_found'}
//   change-set not pending      → 409 {error:'not_pending'}
//   base playbook missing       → 400 {error:'base_playbook_not_found'}
//   resulting narrative empty   → 400 {error:'empty_playbook'}  (the live coach reads it)
//
// Same auth+flag+tenant preamble as playbook/apply. The apply transaction + config-mirror is
// copied verbatim from playbook/apply (the contract: factor a shared helper if clean, else
// mirror it — mirrored here to keep the two apply paths independently auditable). All queries
// tenant-scoped via tagged-template params.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId, jsonb } from '@/lib/db/client';
import { NO_TENANT_ID, currentUserId } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';
import type { PlaybookContent, ObjectionScript } from '@/lib/salesops/playbook-gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function flagOff(): NextResponse | null {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

// ── normalization (same coercers + caps as playbook/apply: keywords 24 / discovery 12 /
//    value_props 10 / objections 16) — so a malformed proposed_value can't poison the snapshot.

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

function strArray(v: unknown, cap: number): string[] {
  let arr: unknown[];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') arr = v.split(/[,\n]/);
  else return [];
  return arr.map((x) => str(x)).filter(Boolean).slice(0, cap);
}

function objectionScripts(v: unknown, cap: number): ObjectionScript[] {
  if (!Array.isArray(v)) return [];
  const out: ObjectionScript[] = [];
  for (const item of v) {
    if (item && typeof item === 'object') {
      const objection = str((item as Record<string, unknown>).objection);
      const response = str((item as Record<string, unknown>).response);
      if (objection || response) out.push({ objection, response });
    }
    if (out.length >= cap) break;
  }
  return out;
}

function normalizeContent(raw: unknown): PlaybookContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    persona: str(r.persona),
    company_name: str(r.company_name),
    product_name: str(r.product_name),
    pricing: str(r.pricing),
    differentiators: str(r.differentiators),
    objection_keywords: strArray(r.objection_keywords, 24).map((k) => k.toLowerCase()),
    opener: str(r.opener),
    discovery_questions: strArray(r.discovery_questions, 12),
    value_props: strArray(r.value_props, 10),
    objection_handling: objectionScripts(r.objection_handling, 16),
    closing: str(r.closing),
    playbook_narrative: str(r.playbook_narrative),
  };
}

// ── change-set application ──────────────────────────────────────────────────────

const PLAYBOOK_FIELDS = [
  'persona',
  'company_name',
  'product_name',
  'pricing',
  'differentiators',
  'objection_keywords',
  'opener',
  'discovery_questions',
  'value_props',
  'objection_handling',
  'closing',
  'playbook_narrative',
] as const;
type PlaybookField = (typeof PLAYBOOK_FIELDS)[number];

const TEXT_FIELDS = new Set<PlaybookField>([
  'persona',
  'company_name',
  'product_name',
  'pricing',
  'differentiators',
  'opener',
  'closing',
  'playbook_narrative',
]);
const STRING_LIST_FIELDS = new Set<PlaybookField>([
  'objection_keywords',
  'discovery_questions',
  'value_props',
]);

const LIST_CAPS: Record<string, number> = {
  objection_keywords: 24,
  discovery_questions: 12,
  value_props: 10,
  objection_handling: 16,
};

function isPlaybookField(v: unknown): v is PlaybookField {
  return typeof v === 'string' && (PLAYBOOK_FIELDS as readonly string[]).includes(v);
}

interface RawChange {
  field: unknown;
  op: unknown;
  proposed_value: unknown;
}

/**
 * Apply ONE accepted change to a draft PlaybookContent in place. The proposed_value is coerced
 * to the field's type with the same caps as the snapshot, so a malformed change can't poison it.
 * 'replace' overwrites; 'append' concatenates (arrays concat + re-cap; text joins with a sep).
 */
function applyChange(draft: PlaybookContent, change: RawChange): void {
  if (!isPlaybookField(change.field)) return; // unknown field → skip (defensive)
  const field = change.field;
  const op = change.op === 'append' ? 'append' : 'replace';

  if (TEXT_FIELDS.has(field)) {
    const next = str(change.proposed_value);
    if (!next) return;
    const textDraft = draft as unknown as Record<string, string>;
    const cur = str(textDraft[field]);
    textDraft[field] = op === 'append' && cur ? `${cur}\n\n${next}` : next;
    return;
  }

  if (STRING_LIST_FIELDS.has(field)) {
    const cap = LIST_CAPS[field] ?? 24;
    let next = strArray(change.proposed_value, cap);
    if (field === 'objection_keywords') next = next.map((k) => k.toLowerCase());
    if (next.length === 0) return;
    if (op === 'append') {
      const cur = (draft as unknown as Record<string, string[]>)[field] ?? [];
      (draft as unknown as Record<string, string[]>)[field] = [...cur, ...next].slice(0, cap);
    } else {
      (draft as unknown as Record<string, string[]>)[field] = next;
    }
    return;
  }

  // objection_handling (ObjectionScript[])
  const cap = LIST_CAPS.objection_handling;
  const next = objectionScripts(change.proposed_value, cap);
  if (next.length === 0) return;
  if (op === 'append') {
    const cur = draft.objection_handling ?? [];
    draft.objection_handling = [...cur, ...next].slice(0, cap);
  } else {
    draft.objection_handling = next;
  }
}

interface ChangesetRow {
  id: string;
  status: string;
  base_playbook_id: string | null;
  changes: unknown;
  sources_used: unknown;
}

interface BasePlaybookRow {
  id: string;
  content: PlaybookContent;
}

interface SalesopsConfigExists {
  tenant_id: string;
}

export async function POST(request: Request) {
  const off = flagOff();
  if (off) return off;
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwnerOrMember();
  if (gate) return gate;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const changesetId = str(body.changeset_id);
  if (!changesetId) {
    return NextResponse.json({ error: 'changeset_id is required' }, { status: 400 });
  }
  const name = str(body.name).slice(0, 120);
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const acceptedIndexes = Array.isArray(body.accepted_indexes)
    ? body.accepted_indexes
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n >= 0)
    : [];

  const s = sql();

  // (1) Load the change-set (tenant-scoped) + guard its state.
  const csRows = (await s`
    SELECT id, status, base_playbook_id, changes, sources_used
    FROM salesops_playbook_changesets
    WHERE id = ${changesetId} AND tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as ChangesetRow[];
  const cs = csRows[0];
  if (!cs) {
    return NextResponse.json({ error: 'changeset_not_found' }, { status: 404 });
  }
  if (cs.status !== 'pending') {
    return NextResponse.json({ error: 'not_pending' }, { status: 409 });
  }

  // (2) Load the BASE playbook this change-set was computed against (tenant-scoped). Start the
  // draft from its content (re-normalized) — NOT from the live active row, so accepted changes
  // apply against exactly what the owner reviewed.
  if (!cs.base_playbook_id) {
    return NextResponse.json({ error: 'base_playbook_not_found' }, { status: 400 });
  }
  const baseRows = (await s`
    SELECT id, content
    FROM salesops_playbooks
    WHERE id = ${cs.base_playbook_id} AND tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as BasePlaybookRow[];
  const base = baseRows[0];
  if (!base) {
    return NextResponse.json({ error: 'base_playbook_not_found' }, { status: 400 });
  }

  // (3) Apply each ACCEPTED change to the draft (by index into the stored changes[]).
  const allChanges: RawChange[] = Array.isArray(cs.changes)
    ? (cs.changes as RawChange[])
    : [];
  const draft = normalizeContent(base.content);
  const acceptSet = new Set(acceptedIndexes);
  for (let i = 0; i < allChanges.length; i++) {
    if (acceptSet.has(i)) applyChange(draft, allChanges[i]);
  }

  // (4) Re-normalize the final draft (caps/coercion) so the snapshot is well-typed.
  const content = normalizeContent(draft);
  if (!content.playbook_narrative) {
    // The narrative is what the live coach reads — refuse to activate an empty playbook.
    return NextResponse.json({ error: 'empty_playbook' }, { status: 400 });
  }

  // inputs jsonb on the new playbook: provenance for the reanalyze path.
  const inputs = {
    source: 'reanalyze',
    changeset_id: cs.id,
    sources_used: Array.isArray(cs.sources_used) ? cs.sources_used : [],
  };
  const uid = currentUserId();

  // (5) INSERT the new playbook AND flip active in ONE transaction (verbatim from playbook/apply,
  // source='reanalyze'). We never UPDATE/DELETE an existing playbook → prior active stays for
  // history/split-testing. Ordering: insert inactive (excluded from the partial-unique-active
  // index), clear the prior active, then set THIS one active. All tenant-scoped.
  const newRow = await s.begin(async (tx) => {
    const insertedRows = (await tx`
      INSERT INTO salesops_playbooks (tenant_id, name, content, inputs, source, is_active, created_by)
      VALUES (${tenantId()}, ${name}, ${jsonb(content)}, ${jsonb(inputs)}, 'reanalyze', false, ${uid})
      RETURNING id, name, is_active
    `) as unknown as Array<{ id: string; name: string; is_active: boolean }>;
    const row = insertedRows[0];
    await tx`
      UPDATE salesops_playbooks
      SET is_active = false, updated_at = now()
      WHERE tenant_id = ${tenantId()} AND is_active AND id <> ${row.id}
    `;
    await tx`
      UPDATE salesops_playbooks
      SET is_active = true, updated_at = now()
      WHERE id = ${row.id} AND tenant_id = ${tenantId()}
    `;
    return row;
  });

  // (6) MIRROR the structured fields into salesops_config so the token-authed /suggest route
  // (loadConfig) uses the new playbook with no route change. Read-or-create the config row, then
  // update only the mirrored fields — leaving suggestion_interval_ms / summary_* intact.
  const existing = (await s`
    SELECT tenant_id FROM salesops_config WHERE tenant_id = ${tenantId()} LIMIT 1
  `) as unknown as SalesopsConfigExists[];
  if (!existing[0]) {
    await s`
      INSERT INTO salesops_config (tenant_id)
      VALUES (${tenantId()})
      ON CONFLICT (tenant_id) DO NOTHING
    `;
  }
  await s`
    UPDATE salesops_config SET
      persona = ${content.persona || null},
      playbook = ${content.playbook_narrative || null},
      company_name = ${content.company_name || null},
      product_name = ${content.product_name || null},
      pricing = ${content.pricing || null},
      differentiators = ${content.differentiators || null},
      objection_keywords = ${jsonb(content.objection_keywords)},
      updated_at = now()
    WHERE tenant_id = ${tenantId()}
  `;

  // (7) Flip the change-set to 'applied' + record which new playbook it became (tenant-scoped).
  await s`
    UPDATE salesops_playbook_changesets
    SET status = 'applied', applied_playbook_id = ${newRow.id}, updated_at = now()
    WHERE id = ${cs.id} AND tenant_id = ${tenantId()}
  `;

  return NextResponse.json({
    playbook: { id: newRow.id, name: newRow.name, is_active: true },
  });
}
