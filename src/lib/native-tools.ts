// Native marketing-data agent tools — the client's OWN pipeline, content,
// analytics, ROI, documents, sequences and competitor intel, exposed to KeyPlayer
// and the sub-agents. Until now agents could only touch goals / drafts / the KG /
// external Jobber; the whole native data layer was invisible. These tools close
// that gap (WIRE-NOW audit, groups 1-7).
//
// Mirrors jobber-tools.ts / firecrawl-tools.ts:
//   - one NAMES set + one definitions() + one handler dispatched by name,
//   - READ tools are read-only and always safe,
//   - the handful of WRITE tools are INTERNAL-STATE ONLY (no external send): a
//     status flip, a watched-competitor row, or a status='raw' document draft the
//     owner must promote before it becomes standing context. Every write is
//     audit-logged. Anything that actually reaches a customer (publish, email,
//     send) stays behind the existing draft→approval tools (save_draft /
//     publish_content / send_email_draft) — these tools never bypass that.
//
// Wiring (see [[orchestrator-tool-wiring]]): NATIVE_TOOL_NAMES must be added in
// FOUR places for KeyPlayer — buildTools defs, CLIENT_TOOL_NAMES, the
// handleClientToolUse dispatch, and a prompt-awareness block — plus the
// subagent.ts filter + handler + defs. Missing the CLIENT_TOOL_NAMES one yields
// "Orchestrator produced no text reply" and the tool silently never runs.
//
// Every underlying lib query is already tenant-scoped (WHERE tenant_id =
// tenantId()); these handlers run inside a run that has already entered the tenant
// context, so no query here can cross tenants.

import Anthropic from '@anthropic-ai/sdk';
import {
  getLeads, getLeadFunnel, updateLeadStatus,
  getContentPosts, updateContentStatus,
  getSequences, getSuppression, updateSequenceStatus,
  getOverviewStats, getDailyMetrics, getWeeklyKPIs,
} from './queries';
import { getRoiSummary } from './roi';
import {
  listDocuments, getDocument, findDocumentByTitle,
  createDocument, appendKnowledgeSection,
} from './documents';
import { listCompetitors, listReels, addCompetitor } from './competitors';
import { getTrendRadar } from './trends';
import { logAudit } from './audit';

export const NATIVE_READ_TOOL_NAMES = [
  'list_leads', 'get_lead_funnel',
  'list_content', 'read_content_calendar',
  'read_analytics', 'read_kpis', 'read_overview',
  'read_roi_summary',
  'list_documents', 'read_document',
  'list_sequences', 'list_suppression',
  'list_competitors', 'read_reels', 'read_trend_radar',
] as const;

export const NATIVE_WRITE_TOOL_NAMES = [
  'update_lead_status',
  'update_content_status',
  'write_report', 'append_to_doc',
  'update_sequence_status',
  'add_competitor',
] as const;

// The full set — recognized by CLIENT_TOOL_NAMES / the sub-agent filter. All of
// these are ALWAYS registered (there is no connect-an-integration gate), so every
// name here is live. Reads are safe; writes are internal-state + audit-logged.
export const NATIVE_TOOL_NAMES = new Set<string>([
  ...NATIVE_READ_TOOL_NAMES,
  ...NATIVE_WRITE_TOOL_NAMES,
]);

// ── result helpers (mirror jobber-tools.ts) ─────────────────────────────────
function ok(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content };
}
function err(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content, is_error: true };
}

function clampLimit(v: unknown, def: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function trunc(v: string | null | undefined, n = 90): string {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${Number(n).toFixed(1)}%`;
}
function name(first: string | null, last: string | null): string {
  const n = [first, last].filter(Boolean).join(' ').trim();
  return n || '(no name)';
}

export function nativeToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  return [
    // ── CRM / Leads / Pipeline ───────────────────────────────────────────────
    {
      name: 'list_leads',
      description:
        "List leads from the client's OWN native CRM pipeline. Read-only. Use this to ground any " +
        'pipeline/outreach recommendation in the real leads (not the external Jobber CRM). Returns each ' +
        "lead's name, company, status, tier, score and id.",
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by pipeline status, e.g. new, contacted, replied, interested, booked, qualified, rejected.' },
          tier: { type: 'string', description: 'Filter by lead tier (e.g. A, B, C).' },
          segment: { type: 'string', description: 'Filter by industry segment.' },
          sort: { type: 'string', enum: ['score', 'created_at', 'last_touch_at', 'company'], description: 'Sort column (default created_at).' },
          order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order (default desc).' },
          limit: { type: 'number', description: 'Max leads to return (default 25, max 100).' },
        },
      },
    },
    {
      name: 'get_lead_funnel',
      description: "Get the client's pipeline funnel — a count of leads at each stage (new → booked → qualified). Read-only.",
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'update_lead_status',
      description:
        "Move a lead to a new pipeline status. INTERNAL state only — this does NOT contact the lead or send " +
        'anything; it just updates the CRM stage (and stamps last_touch_at). To actually email a lead, draft it ' +
        'with save_draft / send_email_draft. Audit-logged.',
      input_schema: {
        type: 'object',
        required: ['lead_id', 'status'],
        properties: {
          lead_id: { type: 'string', description: 'The lead id (from list_leads).' },
          status: { type: 'string', description: 'New status, e.g. contacted, replied, interested, booked, qualified, rejected, disqualified.' },
        },
      },
    },

    // ── Content posts / calendar / library ───────────────────────────────────
    {
      name: 'list_content',
      description:
        "List content posts from the client's library across platforms (IG, FB, X, LinkedIn, YouTube). Read-only. " +
        'Returns platform, status, a text preview, key metrics (impressions, engagement rate) and id.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status, e.g. draft, pending_approval, scheduled, published.' },
          platform: { type: 'string', description: 'Filter by platform, e.g. instagram, x, linkedin, facebook, youtube.' },
          pillar: { type: 'number', description: 'Filter by content pillar number.' },
          limit: { type: 'number', description: 'Max posts to return (default 25, max 100).' },
        },
      },
    },
    {
      name: 'read_content_calendar',
      description:
        'Read the upcoming content calendar — posts that have a scheduled date, soonest first. Read-only. Use to ' +
        'see what is already queued before proposing new content.',
      input_schema: {
        type: 'object',
        properties: {
          include_past: { type: 'boolean', description: 'Include already-past scheduled items (default false = upcoming only).' },
          limit: { type: 'number', description: 'Max items to return (default 25, max 100).' },
        },
      },
    },
    {
      name: 'update_content_status',
      description:
        "Change a content post's status (e.g. move a draft to pending_approval, or approve/schedule it). INTERNAL " +
        'state only — this does NOT publish to any social platform. Actual publishing stays behind the ' +
        'publish_content draft→approval flow. Audit-logged.',
      input_schema: {
        type: 'object',
        required: ['content_id', 'status'],
        properties: {
          content_id: { type: 'string', description: 'The content post id (from list_content).' },
          status: { type: 'string', description: 'New status, e.g. draft, pending_approval, scheduled, published, rejected.' },
        },
      },
    },

    // ── Analytics / KPIs / performance ───────────────────────────────────────
    {
      name: 'read_analytics',
      description:
        "Read the client's daily marketing metrics over a window (impressions, engagement, email sends, replies, " +
        'lead discoveries, bounces). Read-only. Use to ground recommendations in the real numbers.',
      input_schema: {
        type: 'object',
        properties: { days: { type: 'number', description: 'How many days back to summarize (default 30, max 180).' } },
      },
    },
    {
      name: 'read_kpis',
      description: 'Read weekly KPI rollups (leads added, emails sent, reply rate, impressions, engagement rate) for the last N weeks. Read-only.',
      input_schema: {
        type: 'object',
        properties: { weeks: { type: 'number', description: 'How many weeks back (default 8, max 26).' } },
      },
    },
    {
      name: 'read_overview',
      description: "Read today's top-line snapshot: posts today, engagement today, emails sent, and live pipeline count. Read-only.",
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },

    // ── ROI / time-saved ─────────────────────────────────────────────────────
    {
      name: 'read_roi_summary',
      description:
        'Read the ROI / time-saved summary (hours + dollars reclaimed by the agent team, old vs new $/hr of the ' +
        "owner's time, projected annual value, top contributing agents). Read-only. Use for weekly status and " +
        'owner check-ins to report value delivered.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },

    // ── Documents / Reports / SOPs ───────────────────────────────────────────
    {
      name: 'list_documents',
      description:
        'List documents / reports / SOPs in the knowledge base. Read-only. Returns title, type, status (raw / ' +
        'wiki / archived), version and a short excerpt. Docs marked "wiki" (Active) are already injected into you ' +
        'as standing context.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'read_document',
      description: 'Read one document by id OR title (full content). Read-only. Provide either id or title.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The document id.' },
          title: { type: 'string', description: 'The document title (exact, case-insensitive) — used if id is omitted.' },
        },
      },
    },
    {
      name: 'write_report',
      description:
        'Create a new report / document in the knowledge base. It is saved with status="raw" (a draft) — the owner ' +
        'promotes it to "Active" before it becomes standing context, so this is effectively draft-first. Use for ' +
        'weekly status reports, research write-ups, or SOP drafts. Audit-logged.',
      input_schema: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string', description: 'Report/document title.' },
          content: { type: 'string', description: 'The full markdown content.' },
          type: { type: 'string', description: 'Optional type tag, e.g. report, sop, note (default note).' },
        },
      },
    },
    {
      name: 'append_to_doc',
      description:
        'Append a dated section to an existing knowledge-base document (creating it as a status="raw" draft if it ' +
        'does not exist yet). Newest sections go on top. Use to keep a rolling log/doc up to date. Audit-logged.',
      input_schema: {
        type: 'object',
        required: ['title', 'heading', 'body'],
        properties: {
          title: { type: 'string', description: 'The document title to append to (created if missing).' },
          heading: { type: 'string', description: 'The section heading for this entry.' },
          body: { type: 'string', description: 'The markdown body of the section.' },
        },
      },
    },

    // ── Sequences / Outreach ─────────────────────────────────────────────────
    {
      name: 'list_sequences',
      description: 'List outreach email sequences. Read-only. Returns sequence name, step, status, lead id and id.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status, e.g. pending_approval, scheduled, sent, paused.' },
          lead_id: { type: 'string', description: 'Filter to one lead.' },
          limit: { type: 'number', description: 'Max sequences to return (default 25, max 100).' },
        },
      },
    },
    {
      name: 'list_suppression',
      description: 'List the outreach suppression list (emails that must never be contacted: opt-outs, bounces, domain blocks). Read-only. Always check this before drafting outreach.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'update_sequence_status',
      description:
        "Change a sequence's status (e.g. pause it). INTERNAL state only — this does NOT send any email; actual " +
        'sending stays behind send_email_draft / the Gmail tools. Audit-logged.',
      input_schema: {
        type: 'object',
        required: ['sequence_id', 'status'],
        properties: {
          sequence_id: { type: 'string', description: 'The sequence id (from list_sequences).' },
          status: { type: 'string', description: 'New status, e.g. paused, scheduled, cancelled.' },
        },
      },
    },

    // ── Competitors / reels intel / trend radar ──────────────────────────────
    {
      name: 'list_competitors',
      description: 'List the watched competitors (handle, platform, cadence, enabled). Read-only.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'read_reels',
      description:
        'Read stored competitor reels/shorts (caption, metrics, status, id), newest first, optionally for one ' +
        'competitor. Read-only. Use the stored teardowns instead of re-scraping.',
      input_schema: {
        type: 'object',
        properties: {
          competitor_id: { type: 'number', description: 'Optional — only reels for this competitor id.' },
          limit: { type: 'number', description: 'Max reels to return (default 20, max 100).' },
        },
      },
    },
    {
      name: 'read_trend_radar',
      description:
        'Read the trend radar — the hottest winning patterns and top-performing competitor reels over a recent ' +
        "window, plus the reel-analyst's rolling pulse note. Read-only.",
      input_schema: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Window in days (default 30).' } },
      },
    },
    {
      name: 'add_competitor',
      description:
        'Add (or re-adopt) a competitor to the watchlist so their reels get pulled on a cadence. Low-risk internal ' +
        'write — it only starts watching a public handle. Audit-logged.',
      input_schema: {
        type: 'object',
        required: ['handle'],
        properties: {
          handle: { type: 'string', description: 'The competitor handle (e.g. their @username).' },
          platform: { type: 'string', description: 'Platform (default instagram).' },
          display_name: { type: 'string', description: 'Optional friendly name.' },
          schedule: { type: 'string', enum: ['daily', 'weekly', 'off'], description: 'Check cadence (default daily).' },
        },
      },
    },
  ];
}

/**
 * Execute a native-data tool_use block and return a tool_result. Never throws — a
 * bad input or a failed query becomes an is_error tool_result. `sourceAgent` is the
 * agent id (keyplayer or a sub-agent), recorded on write audits for provenance.
 */
export async function handleNativeTool(
  toolUse: Anthropic.ToolUseBlock,
  sourceAgent = 'keyplayer',
): Promise<Anthropic.ToolResultBlockParam> {
  const id = toolUse.id;
  const input = (toolUse.input ?? {}) as Record<string, unknown>;
  const audit = (action: string, detail: Record<string, unknown>) =>
    void logAudit({ actor: null, action, target: sourceAgent, detail }).catch(() => {});

  try {
    switch (toolUse.name) {
      // ── CRM ────────────────────────────────────────────────────────────────
      case 'list_leads': {
        const limit = clampLimit(input.limit, 25, 100);
        const leads = await getLeads({
          status: str(input.status),
          tier: str(input.tier),
          segment: str(input.segment),
          sort: str(input.sort),
          order: input.order === 'asc' ? 'asc' : 'desc',
        });
        if (leads.length === 0) return ok(id, 'No leads matched.');
        const shown = leads.slice(0, limit);
        const lines = shown.map((l) =>
          `- ${name(l.first_name, l.last_name)}${l.company ? ` (${l.company})` : ''} — status=${l.status} tier=${l.tier ?? '—'} score=${l.score ?? '—'} [id=${l.id}]`,
        );
        const more = leads.length > shown.length ? `\n(+${leads.length - shown.length} more; raise limit to see them)` : '';
        return ok(id, `${leads.length} lead(s), showing ${shown.length}:\n${lines.join('\n')}${more}`);
      }
      case 'get_lead_funnel': {
        const funnel = await getLeadFunnel();
        const line = funnel.filter((f) => f.value > 0).map((f) => `${f.name}: ${f.value}`).join(', ');
        return ok(id, line ? `Pipeline funnel — ${line}` : 'Pipeline is empty.');
      }
      case 'update_lead_status': {
        const leadId = str(input.lead_id);
        const status = str(input.status);
        if (!leadId || !status) return err(id, 'update_lead_status: `lead_id` and `status` are required.');
        await updateLeadStatus(leadId, status);
        audit('agent.lead.status_update', { lead_id: leadId, status });
        return ok(id, `Lead ${leadId} moved to status "${status}". (Internal CRM state only — no message was sent.)`);
      }

      // ── Content ──────────────────────────────────────────────────────────────
      case 'list_content': {
        const limit = clampLimit(input.limit, 25, 100);
        const posts = await getContentPosts({
          status: str(input.status),
          platform: str(input.platform),
          pillar: typeof input.pillar === 'number' ? input.pillar : undefined,
        });
        if (posts.length === 0) return ok(id, 'No content posts matched.');
        const shown = posts.slice(0, limit);
        const lines = shown.map((p) =>
          `- [${p.platform}] ${p.status} — "${trunc(p.text_preview)}" (imp=${p.impressions} eng=${pct(p.engagement_rate)}) [id=${p.id}]`,
        );
        const more = posts.length > shown.length ? `\n(+${posts.length - shown.length} more)` : '';
        return ok(id, `${posts.length} post(s), showing ${shown.length}:\n${lines.join('\n')}${more}`);
      }
      case 'read_content_calendar': {
        const limit = clampLimit(input.limit, 25, 100);
        const includePast = input.include_past === true;
        const now = Date.now();
        const all = await getContentPosts();
        const scheduled = all
          .filter((p) => p.scheduled_for)
          .filter((p) => includePast || new Date(p.scheduled_for as string).getTime() >= now)
          .sort((a, b) => new Date(a.scheduled_for as string).getTime() - new Date(b.scheduled_for as string).getTime());
        if (scheduled.length === 0) return ok(id, includePast ? 'No scheduled content found.' : 'No upcoming scheduled content.');
        const shown = scheduled.slice(0, limit);
        const lines = shown.map((p) =>
          `- ${(p.scheduled_for as string).slice(0, 16).replace('T', ' ')} [${p.platform}] ${p.status} — "${trunc(p.text_preview)}" [id=${p.id}]`,
        );
        const more = scheduled.length > shown.length ? `\n(+${scheduled.length - shown.length} more)` : '';
        return ok(id, `${scheduled.length} scheduled item(s), showing ${shown.length}:\n${lines.join('\n')}${more}`);
      }
      case 'update_content_status': {
        const contentId = str(input.content_id);
        const status = str(input.status);
        if (!contentId || !status) return err(id, 'update_content_status: `content_id` and `status` are required.');
        await updateContentStatus(contentId, status);
        audit('agent.content.status_update', { content_id: contentId, status });
        return ok(id, `Content ${contentId} set to status "${status}". (Internal only — not published to any platform.)`);
      }

      // ── Analytics ──────────────────────────────────────────────────────────
      case 'read_analytics': {
        const days = clampLimit(input.days, 30, 180);
        const rows = await getDailyMetrics(days);
        if (rows.length === 0) return ok(id, 'No daily metrics recorded yet.');
        const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
        const totals =
          `Totals over ${rows.length} day(s): impressions=${sum('total_impressions')}, engagement=${sum('total_engagement')}, ` +
          `email_sends=${sum('sends')}, replies_triaged=${sum('replies_triaged')}, lead_discoveries=${sum('discoveries')}, ` +
          `opt_outs=${sum('opt_outs')}, bounces=${sum('bounces')}`;
        const recent = rows.slice(0, 7).map((r) =>
          `- ${r.date}: imp=${r.total_impressions} eng=${r.total_engagement} sends=${r.sends} replies=${r.replies_triaged}`,
        );
        return ok(id, `${totals}\nRecent days:\n${recent.join('\n')}`);
      }
      case 'read_kpis': {
        const weeks = clampLimit(input.weeks, 8, 26);
        const kpis = await getWeeklyKPIs(weeks);
        if (kpis.length === 0) return ok(id, 'No weekly KPIs available yet.');
        const lines = kpis.map((k) =>
          `- ${k.week}: leads=${k.leads_added} emails=${k.emails_sent} reply_rate=${pct(k.reply_rate)} impressions=${k.impressions} eng_rate=${pct(k.engagement_rate)}`,
        );
        return ok(id, `Weekly KPIs (${kpis.length} week(s)):\n${lines.join('\n')}`);
      }
      case 'read_overview': {
        const s = await getOverviewStats();
        return ok(id, `Today — posts: ${s.posts_today}, engagement actions: ${s.engagement_today}, emails sent: ${s.emails_sent}, live pipeline: ${s.pipeline_count}`);
      }

      // ── ROI ────────────────────────────────────────────────────────────────
      case 'read_roi_summary': {
        const r = await getRoiSummary();
        const money = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
        const basis = r.hasActuals ? 'actuals from the time-savings log' : 'projected from the Key Audit only (no logged actions yet)';
        const top = r.byAgent.slice(0, 5).map((a) => `${a.agent_id ?? 'unknown'} (${a.hours.toFixed(1)}h / ${money(a.value)})`).join(', ');
        return ok(
          id,
          `ROI (${basis}):\n` +
            `- Hours saved: ${r.hoursSavedAllTime.toFixed(1)} all-time, ${r.hoursSavedThisMonth.toFixed(1)} this month\n` +
            `- Value reclaimed: ${money(r.valueReclaimed)}\n` +
            `- Owner $/hr: ${money(r.oldDollarPerHour)} → ${money(r.newDollarPerHour)} (projected)\n` +
            `- Projected annual value: ${money(r.projectedAnnualValue)}\n` +
            (top ? `- Top agents: ${top}` : ''),
        );
      }

      // ── Documents ────────────────────────────────────────────────────────────
      case 'list_documents': {
        const docs = await listDocuments();
        if (docs.length === 0) return ok(id, 'No documents in the knowledge base yet.');
        const lines = docs.slice(0, 60).map((d) =>
          `- "${d.title}" [${d.type}/${d.status} v${d.version}] id=${d.id} — ${trunc(d.excerpt, 80)}`,
        );
        return ok(id, `${docs.length} document(s):\n${lines.join('\n')}`);
      }
      case 'read_document': {
        const docId = str(input.id);
        const title = str(input.title);
        if (!docId && !title) return err(id, 'read_document: provide either `id` or `title`.');
        const doc = docId ? await getDocument(docId) : await findDocumentByTitle(title as string);
        if (!doc) return ok(id, `No document found for ${docId ? `id ${docId}` : `title "${title}"`}.`);
        const body = doc.content.length > 4000 ? `${doc.content.slice(0, 4000)}\n…(truncated)` : doc.content;
        return ok(id, `# ${doc.title} [${doc.type}/${doc.status} v${doc.version}] id=${doc.id}\n\n${body}`);
      }
      case 'write_report': {
        const title = str(input.title);
        const content = typeof input.content === 'string' ? input.content : '';
        if (!title || !content.trim()) return err(id, 'write_report: `title` and non-empty `content` are required.');
        const doc = await createDocument({ title, content, type: str(input.type) ?? 'report', status: 'raw' });
        audit('agent.document.create', { document_id: doc.id, title });
        return ok(id, `Saved report "${doc.title}" as id=${doc.id} (status=raw / draft). The owner promotes it to Active in Reports before it becomes standing context.`);
      }
      case 'append_to_doc': {
        const title = str(input.title);
        const heading = str(input.heading);
        const body = typeof input.body === 'string' ? input.body : '';
        if (!title || !heading || !body.trim()) return err(id, 'append_to_doc: `title`, `heading` and non-empty `body` are required.');
        const docId = await appendKnowledgeSection(title, heading, body);
        audit('agent.document.append', { document_id: docId, title, heading });
        return ok(id, `Appended "${heading}" to "${title}" (id=${docId}).`);
      }

      // ── Sequences ────────────────────────────────────────────────────────────
      case 'list_sequences': {
        const limit = clampLimit(input.limit, 25, 100);
        const seqs = await getSequences({ status: str(input.status), lead_id: str(input.lead_id) });
        if (seqs.length === 0) return ok(id, 'No sequences matched.');
        const shown = seqs.slice(0, limit);
        const lines = shown.map((q) =>
          `- "${q.sequence_name ?? '(unnamed)'}" step=${q.step ?? '—'} ${q.status ?? 'unknown'} lead=${q.lead_id} [id=${q.id}]`,
        );
        const more = seqs.length > shown.length ? `\n(+${seqs.length - shown.length} more)` : '';
        return ok(id, `${seqs.length} sequence(s), showing ${shown.length}:\n${lines.join('\n')}${more}`);
      }
      case 'list_suppression': {
        const supp = await getSuppression();
        if (supp.length === 0) return ok(id, 'Suppression list is empty.');
        const shown = supp.slice(0, 100);
        const lines = shown.map((s) => `- ${s.email} [${s.type ?? 'suppressed'}]`);
        const more = supp.length > shown.length ? `\n(+${supp.length - shown.length} more)` : '';
        return ok(id, `${supp.length} suppressed address(es):\n${lines.join('\n')}${more}`);
      }
      case 'update_sequence_status': {
        const seqId = str(input.sequence_id);
        const status = str(input.status);
        if (!seqId || !status) return err(id, 'update_sequence_status: `sequence_id` and `status` are required.');
        await updateSequenceStatus(seqId, status);
        audit('agent.sequence.status_update', { sequence_id: seqId, status });
        return ok(id, `Sequence ${seqId} set to status "${status}". (Internal only — no email was sent.)`);
      }

      // ── Competitors ──────────────────────────────────────────────────────────
      case 'list_competitors': {
        const comps = await listCompetitors();
        if (comps.length === 0) return ok(id, 'No competitors on the watchlist yet.');
        const lines = comps.map((c) =>
          `- @${c.handle} [${c.platform}] ${c.schedule} enabled=${c.enabled}${c.display_name ? ` — ${c.display_name}` : ''} [id=${c.id}]`,
        );
        return ok(id, `${comps.length} competitor(s):\n${lines.join('\n')}`);
      }
      case 'read_reels': {
        const limit = clampLimit(input.limit, 20, 100);
        const cid = typeof input.competitor_id === 'number' ? input.competitor_id : undefined;
        const reels = await listReels({ competitor_id: cid, limit });
        if (reels.length === 0) return ok(id, 'No stored reels found.');
        const lines = reels.map((r) =>
          `- [${r.platform}] views=${r.views ?? '—'} likes=${r.likes ?? '—'} ${r.status} "${trunc(r.caption)}" [id=${r.id}]`,
        );
        return ok(id, `${reels.length} reel(s):\n${lines.join('\n')}`);
      }
      case 'read_trend_radar': {
        const days = typeof input.days === 'number' ? input.days : undefined;
        const radar = await getTrendRadar({ days });
        const tags = radar.topTags.map((t) => `${t.label} (${t.count})`).join(', ') || 'none yet';
        const reels = radar.topReels
          .slice(0, 5)
          .map((r) => `- views=${r.views ?? '—'} "${trunc(r.caption)}" (${r.url})`)
          .join('\n');
        return ok(
          id,
          `Trend radar (last ${radar.windowDays}d, ${radar.analyzedCount} analyzed reels):\n` +
            `- Hot patterns: ${tags}\n` +
            (reels ? `- Top reels:\n${reels}\n` : '') +
            (radar.pulse ? `- Pulse: ${trunc(radar.pulse, 300)}` : ''),
        );
      }
      case 'add_competitor': {
        const handle = str(input.handle);
        if (!handle) return err(id, 'add_competitor: `handle` is required.');
        const sched = input.schedule === 'weekly' || input.schedule === 'off' ? input.schedule : 'daily';
        const comp = await addCompetitor({
          handle,
          platform: str(input.platform),
          display_name: str(input.display_name),
          schedule: sched,
        });
        audit('agent.competitor.add', { competitor_id: comp.id, handle: comp.handle, platform: comp.platform });
        return ok(id, `Now watching @${comp.handle} [${comp.platform}] on a ${comp.schedule} cadence (id=${comp.id}).`);
      }

      default:
        return err(id, `Unknown native tool: ${toolUse.name}`);
    }
  } catch (e) {
    return err(id, `${toolUse.name} failed: ${(e as Error).message}`);
  }
}
