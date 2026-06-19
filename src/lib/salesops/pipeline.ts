// SalesOps data pipeline — turns a finished sales call into durable, tenant-scoped
// signal the rest of Command Center can act on. Called by the token-authed
// /api/salesops/* routes (Engineer A): recordSuggestTurn() during the live call and
// ingestCallSummary() once /summary returns Claude's CRM write-up.
//
// WHAT IT DOES (all four, all best-effort, all tenant-scoped):
//   (a) PERSIST   — upsert/close a public.sales_calls row (transcript, summary, parsed
//                   deal temperature, and the structured insight lists in metadata).
//   (b) KG        — write the call's key insights (deal temp, objections, pain points,
//                   next steps) into the knowledge graph via remember(), stamped
//                   sourceAgent:'salesops', so the tenant's agents READ them.
//   (c) CRM       — find-or-create the contact as a public.leads row, link it to the
//                   call, and log a CRM activity_log entry + per-action follow-up tasks.
//   (d) DRAFT     — optionally draft a follow-up email via createDraft(). This reuses the
//                   EXISTING autonomy gate (drafts.ts → gateOutbound): default Propose mode
//                   leaves it a pending draft for owner approval; it only auto-sends when
//                   the tenant is already in an execute autonomy level WITH AgentMail wired.
//                   We never invent a new auto-send path here.
//
// HARD RULES (per the build plan):
//   - Every INSERT/SELECT/UPDATE filters tenant_id (= tenantId()); the postgres role
//     bypasses RLS, so this scoping IS the isolation.
//   - BEST-EFFORT: a pipeline failure must NEVER throw into the /summary (or /suggest)
//     response the rep is waiting on. Every step is wrapped; failures are logged and
//     swallowed. The functions resolve normally even on partial failure.
//   - Follow-up SENDING obeys the existing kill switches: we only ever create a DRAFT
//     (createDraft's gate decides whether it stays pending or executes) — we never write
//     directly into public.sequences or any auto-send path of our own.

import { sql, jsonb, tenantId } from '@/lib/db/client';
import { currentUserId } from '@/lib/tenant';
import { remember } from '@/lib/kg';
import { createDraft } from '@/lib/drafts';

// ── Types ──────────────────────────────────────────────────────────────────────

export type DealTemp = 'HOT' | 'WARM' | 'COLD';

/** Structured insights parsed out of Claude's CRM summary text. */
export interface CallInsights {
  deal_temp: DealTemp | null;
  objections: string[];
  pain_points: string[];
  next_steps: string[];
  action_items: string[];
}

export interface IngestCallSummaryInput {
  /** Existing sales_calls.id (from recordSuggestTurn) — closes that row if present,
   *  otherwise a fresh row is created. */
  callId?: string | null;
  /** Full final transcript of the call. */
  transcript?: string | null;
  /** Raw CRM summary text returned by /api/salesops/summary (Claude). */
  summary: string;
  /** Page host bucket: 'meet' | 'zoom' | 'teams' | 'webex' | null. */
  platform?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  /** When true (tenant opted in), also draft a follow-up email. Default: off. */
  draftFollowupEmail?: boolean;
}

export interface IngestResult {
  callId: string | null;
  leadId: string | null;
  insights: CallInsights;
  draftId: number | null;
}

export interface RecordSuggestTurnInput {
  /** Existing sales_calls.id to bump; omitted/unknown → a new in-progress row is created. */
  callId?: string | null;
  transcript?: string | null;
  /** The suggestion text Claude streamed back (unused for storage today; reserved). */
  suggestionText?: string | null;
  isObjection?: boolean;
  /** Page host bucket if the extension sent it on the first turn. */
  platform?: string | null;
}

// ── Summary parsing (pure) ───────────────────────────────────────────────────────

/**
 * Parse Claude's CRM summary into structured insights. The summary follows the
 * DEAL_TEMP:/OBJECTIONS:/PAIN_POINTS:/NEXT_STEPS:/ACTION_ITEMS: section format the
 * /summary system prompt produces. Tolerant: missing sections → empty lists; bullets
 * may be "-", "*", "•", or numbered. Exported for unit testing.
 */
export function parseCallSummary(summary: string): CallInsights {
  const text = summary ?? '';

  const dealMatch = text.match(/DEAL_TEMP:\s*(HOT|WARM|COLD)/i);
  const deal_temp = (dealMatch ? dealMatch[1].toUpperCase() : null) as DealTemp | null;

  return {
    deal_temp,
    objections: extractSection(text, 'OBJECTIONS'),
    pain_points: extractSection(text, 'PAIN_POINTS'),
    next_steps: extractSection(text, 'NEXT_STEPS'),
    action_items: extractSection(text, 'ACTION_ITEMS'),
  };
}

/** Section labels we scan for, used to know where one section ends and the next begins. */
const SECTION_LABELS = ['DEAL_TEMP', 'OBJECTIONS', 'PAIN_POINTS', 'NEXT_STEPS', 'ACTION_ITEMS'];

/**
 * Pull the bullet/line items under `LABEL:` up to the next known section label (or EOF).
 * Strips leading bullet markers and numbering; drops empties and a literal "none".
 */
function extractSection(text: string, label: string): string[] {
  // Match "LABEL:" then capture everything until the next SECTION label at line start or EOF.
  const others = SECTION_LABELS.filter((l) => l !== label).join('|');
  // Capture lazily from "LABEL:" up to the next section label at a line start, OR the end
  // of the whole string. `$(?![\s\S])` = true end-of-input (the `m`-flag `$` alone would
  // only match end-of-LINE). Case-insensitive + multiline.
  const re = new RegExp(
    `${label}:\\s*([\\s\\S]*?)(?=(?:^\\s*(?:${others}):)|$(?![\\s\\S]))`,
    'im',
  );
  const m = text.match(re);
  if (!m) return [];

  return m[1]
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*•·]\s+/, '') // bullet markers
        .replace(/^\s*\d+[.)]\s+/, '') // "1. " / "1) "
        .trim(),
    )
    .filter((line) => line.length > 0)
    .filter((line) => !/^none\.?$/i.test(line) && !/^n\/?a$/i.test(line));
}

// ── (a) PERSIST ─────────────────────────────────────────────────────────────────

/** Mint a sales_calls UUID-friendly text id is unnecessary — the column is uuid with a
 *  DB default. We create rows via INSERT ... RETURNING id and let Postgres assign it. */

interface SalesCallRow {
  id: string;
}

/**
 * Ensure the ONE in-progress sales_calls row for this call exists, and return its
 * SERVER id. `callId` is the extension's STABLE client-generated id, sent identically
 * on every /suggest turn + /summary — we correlate on the client_call_id column via a
 * RACE-SAFE upsert (the unique (tenant_id, client_call_id) index), so a whole call
 * collapses onto a single row instead of a fresh row per turn. No client id (the
 * crypto-unavailable fallback) → a plain fresh row. Tenant-scoped throughout.
 */
async function ensureCallRow(callId: string | null | undefined, platform?: string | null): Promise<string | null> {
  if (callId) {
    const rows = (await sql()`
      INSERT INTO public.sales_calls (tenant_id, created_by, platform, started_at, client_call_id)
      VALUES (${tenantId()}, ${currentUserId()}, ${platform ?? null}, now(), ${callId})
      ON CONFLICT (tenant_id, client_call_id) WHERE client_call_id IS NOT NULL
        DO UPDATE SET platform = COALESCE(public.sales_calls.platform, EXCLUDED.platform)
      RETURNING id
    `) as unknown as SalesCallRow[];
    if (rows[0]?.id) return rows[0].id;
  }
  const created = (await sql()`
    INSERT INTO public.sales_calls (tenant_id, created_by, platform, started_at)
    VALUES (${tenantId()}, ${currentUserId()}, ${platform ?? null}, now())
    RETURNING id
  `) as unknown as SalesCallRow[];
  return created[0]?.id ?? null;
}

// ── (c) CRM helpers ───────────────────────────────────────────────────────────────

function makeLeadId(): string {
  return `lead_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** Split a free-text contact name into first/last (best-effort). */
function splitName(name?: string | null): { first: string | null; last: string | null } {
  const n = (name ?? '').trim();
  if (!n) return { first: null, last: null };
  const parts = n.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

interface LeadIdRow {
  id: string;
}

/**
 * Find-or-create a lead for this contact (by case-insensitive email match within the
 * tenant). Returns the lead id, or null when there's no email to key on. Tenant-scoped.
 * A newly created lead is parked at status 'new' (NOT an outreach-eligible status), so the
 * cadence dispatcher will never auto-email it off the back of a call — exactly the safe
 * default the plan requires.
 */
async function findOrCreateLead(
  contactEmail?: string | null,
  contactName?: string | null,
): Promise<string | null> {
  const email = (contactEmail ?? '').trim();
  if (!email) return null;

  const existing = (await sql()`
    SELECT id FROM public.leads
    WHERE tenant_id = ${tenantId()} AND lower(email) = lower(${email})
    ORDER BY created_at ASC
    LIMIT 1
  `) as unknown as LeadIdRow[];
  if (existing[0]?.id) return existing[0].id;

  const id = makeLeadId();
  const { first, last } = splitName(contactName);
  await sql()`
    INSERT INTO public.leads (tenant_id, id, first_name, last_name, email, source, status, created_at)
    VALUES (${tenantId()}, ${id}, ${first}, ${last}, ${email}, 'salesops', 'new', now())
  `;
  return id;
}

/** Append a CRM activity_log row (best-effort). Matches cadence-dispatch's shape. */
async function logCrmActivity(detail: string): Promise<void> {
  await sql()`
    INSERT INTO public.activity_log (tenant_id, ts, action, detail, result)
    VALUES (${tenantId()}, now(), 'crm', ${detail}, NULL)
  `.catch((e) => console.error('[salesops] activity_log failed:', (e as Error).message));
}

// ── (b) KG ──────────────────────────────────────────────────────────────────────

/**
 * Write the call's insights into the knowledge graph so agents READ them. Uses only the
 * allowed ontology: kinds person/topic/event and labels mentions/related_to/resulted_in.
 * The call is an 'event'; the contact a 'person'; each pain point / objection a 'topic'.
 * Best-effort.
 */
async function writeKg(
  insights: CallInsights,
  opts: { callDate: string; contactName?: string | null; companyName?: string | null },
): Promise<void> {
  const eventName = `Sales call ${opts.callDate}${opts.contactName ? ` with ${opts.contactName}` : ''}`;

  const entities: Parameters<typeof remember>[0]['entities'] = [
    {
      kind: 'event',
      name: eventName,
      attributes: {
        deal_temp: insights.deal_temp,
        objections: insights.objections,
        pain_points: insights.pain_points,
        next_steps: insights.next_steps,
        action_items: insights.action_items,
        source: 'salesops',
        at: opts.callDate,
      },
    },
  ];
  const relations: NonNullable<Parameters<typeof remember>[0]['relations']> = [];

  if (opts.contactName?.trim()) {
    entities.push({ kind: 'person', name: opts.contactName.trim() });
    relations.push({
      from: { kind: 'person', name: opts.contactName.trim() },
      to: { kind: 'event', name: eventName },
      label: 'mentions',
    });
  }

  // Each distinct pain point / objection becomes a topic the call "mentions".
  const topics = Array.from(new Set([...insights.pain_points, ...insights.objections]))
    .map((t) => t.slice(0, 200))
    .filter(Boolean)
    .slice(0, 20); // bound the fan-out
  for (const topic of topics) {
    entities.push({ kind: 'topic', name: topic });
    relations.push({
      from: { kind: 'event', name: eventName },
      to: { kind: 'topic', name: topic },
      label: 'mentions',
    });
  }

  await remember({ entities, relations }, { sourceAgent: 'salesops' });
}

// ── (d) Follow-up email draft ─────────────────────────────────────────────────────

/**
 * Compose a plain-text follow-up email body from the parsed insights. Deliberately simple
 * and conservative — this is a STARTING POINT the owner reviews/edits; createDraft's
 * autonomy gate decides whether it ever sends.
 */
function composeFollowupEmail(insights: CallInsights, contactName?: string | null): string {
  const greeting = contactName?.trim() ? `Hi ${contactName.trim().split(/\s+/)[0]},` : 'Hi there,';
  const lines: string[] = [greeting, '', 'Thanks for taking the time to chat today.'];

  if (insights.pain_points.length) {
    lines.push('', 'To recap what you raised:');
    for (const p of insights.pain_points.slice(0, 5)) lines.push(`  • ${p}`);
  }
  if (insights.next_steps.length) {
    lines.push('', 'Next steps from our side:');
    for (const s of insights.next_steps.slice(0, 5)) lines.push(`  • ${s}`);
  }
  lines.push('', 'Let me know if I missed anything — happy to keep the ball rolling.', '', 'Best,');
  return lines.join('\n');
}

// ── Public: live-call turn ──────────────────────────────────────────────────────

/**
 * Lightweight per-turn record during a live call. Ensures an in-progress sales_calls row
 * (creating it on the first turn, keyed by the optional callId the extension can echo back)
 * and bumps suggestions_count. Cheap, tenant-scoped, best-effort — it NEVER throws into the
 * /suggest stream. Returns the (possibly newly created) callId so the extension can carry
 * it forward to the next turn and to /summary.
 */
export async function recordSuggestTurn(input: RecordSuggestTurnInput): Promise<{ callId: string | null }> {
  try {
    const callId = await ensureCallRow(input.callId, input.platform);
    if (!callId) return { callId: null };

    await sql()`
      UPDATE public.sales_calls
      SET suggestions_count = suggestions_count + 1
      WHERE id = ${callId} AND tenant_id = ${tenantId()}
    `;
    return { callId };
  } catch (e) {
    console.error('[salesops] recordSuggestTurn failed:', (e as Error).message);
    return { callId: input.callId ?? null };
  }
}

// ── Public: end-of-call ingest ────────────────────────────────────────────────────

/**
 * Run the full pipeline after /summary returns. Persists the call, writes insights to the
 * KG, find-or-creates the CRM lead + logs the touch + per-action follow-up notes, and
 * (optionally) drafts a follow-up email through the existing autonomy gate.
 *
 * BEST-EFFORT throughout: each stage is independently guarded so a failure in one (e.g. KG
 * write) never aborts the others and never throws into the /summary response. Returns what
 * it managed to do.
 */
export async function ingestCallSummary(input: IngestCallSummaryInput): Promise<IngestResult> {
  const insights = parseCallSummary(input.summary);
  const callDate = new Date().toISOString().slice(0, 10);

  let callId: string | null = input.callId ?? null;
  let leadId: string | null = null;
  let draftId: number | null = null;

  // (a) PERSIST — upsert/close the sales_calls row.
  try {
    callId = await ensureCallRow(input.callId, input.platform);
    if (callId) {
      await sql()`
        UPDATE public.sales_calls
        SET ended_at      = now(),
            transcript    = COALESCE(${input.transcript ?? null}, transcript),
            summary       = ${input.summary},
            deal_temp     = ${insights.deal_temp},
            platform      = COALESCE(${input.platform ?? null}, platform),
            contact_name  = COALESCE(${input.contactName ?? null}, contact_name),
            contact_email = COALESCE(${input.contactEmail ?? null}, contact_email),
            metadata      = ${jsonb({
              objections: insights.objections,
              pain_points: insights.pain_points,
              next_steps: insights.next_steps,
              action_items: insights.action_items,
            })}
        WHERE id = ${callId} AND tenant_id = ${tenantId()}
      `;
    }
  } catch (e) {
    console.error('[salesops] persist sales_call failed:', (e as Error).message);
  }

  // (b) KG — write insights for agents to read.
  try {
    await writeKg(insights, { callDate, contactName: input.contactName });
  } catch (e) {
    console.error('[salesops] KG write failed:', (e as Error).message);
  }

  // (c) CRM — find-or-create lead, link it, log the touch + follow-up actions.
  try {
    leadId = await findOrCreateLead(input.contactEmail, input.contactName);
    if (leadId && callId) {
      await sql()`
        UPDATE public.sales_calls
        SET lead_id = ${leadId}
        WHERE id = ${callId} AND tenant_id = ${tenantId()}
      `.catch((e) => console.error('[salesops] link lead failed:', (e as Error).message));
    }
    if (leadId) {
      const tempLabel = insights.deal_temp ? ` — deal ${insights.deal_temp}` : '';
      await logCrmActivity(`lead:${leadId} salesops call summarized${tempLabel}`);

      // Each next step / action item becomes a follow-up note in the timeline. We do NOT
      // write a live sequence here — auto-sending is owned by the cadence engine and its
      // kill switches; the email DRAFT below (d) is the only outbound path, and it's gated.
      const followups = Array.from(new Set([...insights.next_steps, ...insights.action_items]))
        .map((s) => s.slice(0, 300))
        .filter(Boolean)
        .slice(0, 10);
      for (const f of followups) {
        await logCrmActivity(`lead:${leadId} follow-up: ${f}`);
      }
    }
  } catch (e) {
    console.error('[salesops] CRM pipeline failed:', (e as Error).message);
  }

  // (d) Follow-up email DRAFT — only when the tenant opted in. Goes through createDraft's
  // autonomy gate (Propose mode → stays pending for owner approval; never auto-sends unless
  // the tenant is already in an execute level with AgentMail wired). createDraft throws
  // AutonomyBlockedError in observe mode — swallow it; a blocked draft is expected.
  if (input.draftFollowupEmail) {
    try {
      const title = `Follow-up: ${input.contactName?.trim() || input.contactEmail || 'sales call'}`;
      const draft = await createDraft({
        type: 'email',
        title,
        payload: composeFollowupEmail(insights, input.contactName),
        createdBy: currentUserId() ?? undefined,
        metadata: {
          source: 'salesops',
          call_id: callId,
          lead_id: leadId,
          deal_temp: insights.deal_temp,
          // No platform/recipient wiring → drafts.ts sendEmail() simulates rather than
          // sending, even if the tenant is in execute mode without an agentmail block.
        },
      });
      draftId = draft.id;
    } catch (e) {
      // AutonomyBlockedError (observe mode) or any draft failure — non-fatal.
      console.error('[salesops] follow-up draft skipped:', (e as Error).message);
    }
  }

  return { callId, leadId, insights, draftId };
}
