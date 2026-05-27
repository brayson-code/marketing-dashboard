import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { writebackLeadUpdate, writebackSequenceStatus } from '@/lib/writeback';
import type { Lead, Sequence, FunnelStep } from '@/types';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export const dynamic = "force-dynamic";

const LEAD_APPROVED_STATUS = "approved";
const ALLOWED_LEAD_STATUSES = new Set([
  "new",
  "validated",
  "approved",
  "contacted",
  "replied",
  "interested",
  "booked",
  "qualified",
  "rejected",
  "disqualified",
]);

export async function GET(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const s = sql();

  // Single lead detail
  if (id) {
    const leadRows = await s`SELECT * FROM leads WHERE id = ${id} AND tenant_id = ${tenantId()}` as unknown as Lead[];
    const lead = leadRows[0];
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const sequences = await s`
      SELECT * FROM sequences WHERE lead_id = ${id} AND tenant_id = ${tenantId()}
      ORDER BY step ASC, created_at DESC
    ` as unknown as Sequence[];

    // Build timeline from sequences + activity
    const timeline: { id: number; type: string; description: string; timestamp: string }[] = [];
    let timelineId = 0;

    for (const seq of sequences) {
      if (seq.sent_at) {
        timeline.push({
          id: ++timelineId,
          type: 'sequence_sent',
          description: `Email step ${seq.step}: "${seq.subject || 'No subject'}" sent`,
          timestamp: seq.sent_at,
        });
      }
      if (seq.status === 'pending_approval') {
        timeline.push({
          id: ++timelineId,
          type: 'pending_approval',
          description: `Email step ${seq.step}: "${seq.subject || 'No subject'}" awaiting approval`,
          timestamp: seq.created_at,
        });
      }
      if (seq.status === 'approved') {
        timeline.push({
          id: ++timelineId,
          type: 'approved',
          description: `Email step ${seq.step}: approved`,
          timestamp: seq.created_at,
        });
      }
      if (seq.status === 'cancelled') {
        timeline.push({
          id: ++timelineId,
          type: 'cancelled',
          description: `Email step ${seq.step}: cancelled`,
          timestamp: seq.created_at,
        });
      }
      if (seq.status === 'queued') {
        timeline.push({
          id: ++timelineId,
          type: 'queued',
          description: `Email step ${seq.step}: queued`,
          timestamp: seq.created_at,
        });
      }
    }

    if (lead.created_at) {
      timeline.push({
        id: ++timelineId,
        type: 'discovery',
        description: `Lead discovered via ${lead.source || 'unknown source'}`,
        timestamp: lead.created_at,
      });
    }

    // CRM activity log entries (status/notes updates, etc.)
    const activityRows = await s`
      SELECT ts, detail FROM activity_log
      WHERE tenant_id = ${tenantId()} AND action = 'crm' AND detail LIKE ${`lead:${id}%`}
      ORDER BY ts DESC LIMIT 50
    ` as unknown as { ts: string | Date; detail: string }[];
    for (const row of activityRows) {
      timeline.push({
        id: ++timelineId,
        type: 'crm',
        description: row.detail,
        timestamp: typeof row.ts === 'string' ? row.ts : new Date(row.ts).toISOString(),
      });
    }

    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({ lead, sequences, timeline });
  }

  // List all leads with summary stats
  // Note: seed filtering is a no-op (no seed_registry table in Supabase).
  const status = searchParams.get('status');
  const tier = searchParams.get('tier');
  const search = searchParams.get('search');
  const like = search ? `%${search}%` : null;

  const leads = await s`
    SELECT * FROM leads
    WHERE tenant_id = ${tenantId()}
    ${status ? s`AND status = ${status}` : s``}
    ${tier ? s`AND tier = ${tier}` : s``}
    ${like ? s`AND (first_name ILIKE ${like} OR last_name ILIKE ${like} OR company ILIKE ${like} OR email ILIKE ${like})` : s``}
    ORDER BY score DESC NULLS LAST, created_at DESC
  ` as unknown as Lead[];

  const stages = ["new", "validated", "approved", "contacted", "replied", "interested", "booked", "qualified", "rejected", "disqualified"];
  const funnelRows = await s`
    SELECT status, COUNT(*) as c FROM leads
    WHERE tenant_id = ${tenantId()}
    GROUP BY status
  ` as unknown as { status: string; c: string }[];
  const funnelMap = new Map(funnelRows.map(r => [r.status, Number(r.c)]));
  const funnel: FunnelStep[] = stages.map(name => ({ name, value: funnelMap.get(name) ?? 0 }));

  const [totalRows, avgScoreRows, tierBreakdownRows, pendingApprovalsRows, emailsSentRows, contactedRows, repliedRows] = await Promise.all([
    s`SELECT COUNT(*) as c FROM leads WHERE tenant_id = ${tenantId()}`,
    s`SELECT AVG(score) as avg FROM leads WHERE tenant_id = ${tenantId()} AND score IS NOT NULL`,
    s`SELECT tier, COUNT(*) as c FROM leads WHERE tenant_id = ${tenantId()} AND tier IS NOT NULL GROUP BY tier ORDER BY tier`,
    s`SELECT COUNT(*) as c FROM sequences WHERE tenant_id = ${tenantId()} AND status = 'pending_approval'`,
    s`SELECT COUNT(*) as c FROM sequences WHERE tenant_id = ${tenantId()} AND status = 'sent'`,
    s`SELECT COUNT(*) as c FROM leads WHERE tenant_id = ${tenantId()} AND status IN ('contacted','replied','interested','booked','qualified')`,
    s`SELECT COUNT(*) as c FROM leads WHERE tenant_id = ${tenantId()} AND status IN ('replied','interested','booked','qualified')`,
  ]);

  const totalLeads = Number(totalRows[0]?.c ?? 0);
  const avgScore = Number(avgScoreRows[0]?.avg ?? 0);
  const tierBreakdown = (tierBreakdownRows as unknown as { tier: string; c: string }[]).map(r => ({ tier: r.tier, c: Number(r.c) }));
  const pendingApprovals = Number(pendingApprovalsRows[0]?.c ?? 0);
  const emailsSent = Number(emailsSentRows[0]?.c ?? 0);
  const contacted = Number(contactedRows[0]?.c ?? 0);
  const replied = Number(repliedRows[0]?.c ?? 0);
  const conversionRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;

  return NextResponse.json({
    leads,
    funnel,
    summary: {
      total: totalLeads,
      avg_score: Math.round(avgScore),
      tier_breakdown: tierBreakdown,
      pending_approvals: pendingApprovals,
      emails_sent: emailsSent,
      conversion_rate: conversionRate,
    },
  });
}

export async function PATCH(request: Request) {
  const auth = requireApiEditor(request as Request);
  if (auth) return auth;
  const actor = requireUser(request as Request);
  try {
    const body = await request.json();
    const { id, type, task_done, ...updates } = body as { id?: string; type?: string; task_done?: boolean } & Record<string, unknown>;

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    const s = sql();

    // Sequence update (approve/reject)
    if (type === "sequence") {
      const allowedStatuses = ["approved", "cancelled", "queued"];
      const nextStatus = typeof updates.status === "string" ? updates.status : null;
      if (!nextStatus || !allowedStatuses.includes(nextStatus)) {
        return NextResponse.json({ error: "Invalid sequence status" }, { status: 400 });
      }

      if (nextStatus === "approved" || nextStatus === "queued") {
        const rows = await s`
          SELECT l.status as lead_status
          FROM sequences seq
          LEFT JOIN leads l ON l.id = seq.lead_id AND l.tenant_id = ${tenantId()}
          WHERE seq.id = ${id} AND seq.tenant_id = ${tenantId()}
        ` as unknown as { lead_status: string | null }[];
        const lead = rows[0];
        if (!lead || lead.lead_status !== LEAD_APPROVED_STATUS) {
          return NextResponse.json({ error: "Lead must be approved before outreach can be queued or approved" }, { status: 409 });
        }
      }

      await s`UPDATE sequences SET status = ${nextStatus} WHERE id = ${id} AND tenant_id = ${tenantId()}`;
      writebackSequenceStatus(id, nextStatus);
      await logAudit({
        actor,
        action: "crm.sequence.update_status",
        target: `sequence:${id}`,
        detail: { status: nextStatus },
      });
      return NextResponse.json({ ok: true });
    }

    // Lead update
    const allowed = ["status", "tier", "notes", "pause_outreach", "next_action_at"];
    const setValues: Record<string, unknown> = {};
    const beforeRows = await s`
      SELECT status, tier, notes, pause_outreach, next_action_at FROM leads
      WHERE id = ${id} AND tenant_id = ${tenantId()}
    ` as unknown as Lead[];
    const before = beforeRows[0];

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        if (key === "status") {
          if (typeof updates[key] !== "string" || !ALLOWED_LEAD_STATUSES.has(updates[key] as string)) {
            return NextResponse.json({ error: "Invalid lead status" }, { status: 400 });
          }
        }
        if (key === "pause_outreach") {
          setValues[key] = !!updates[key];
        } else {
          setValues[key] = updates[key];
        }
      }
    }

    if (Object.keys(setValues).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    setValues.last_touch_at = new Date().toISOString();

    await s`
      UPDATE leads SET ${s(setValues)}
      WHERE id = ${id} AND tenant_id = ${tenantId()}
    `;

    // Writeback to state file
    const writebackUpdates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) writebackUpdates[key] = updates[key];
    }
    writebackLeadUpdate(id, writebackUpdates);

    const leadRows = await s`SELECT * FROM leads WHERE id = ${id} AND tenant_id = ${tenantId()}`;
    const lead = leadRows[0];
    if (before) {
      const changes: string[] = [];
      if (updates.status && before.status !== updates.status) changes.push(`status: ${before.status} -> ${updates.status}`);
      if (updates.tier && before.tier !== updates.tier) changes.push(`tier: ${before.tier ?? '—'} -> ${updates.tier}`);
      if (updates.notes !== undefined && before.notes !== updates.notes) changes.push('notes updated');
      if (updates.pause_outreach !== undefined && Boolean(before.pause_outreach) !== !!updates.pause_outreach) {
        changes.push(`outreach ${updates.pause_outreach ? 'paused' : 'resumed'}`);
      }
      if (updates.next_action_at !== undefined && before.next_action_at !== updates.next_action_at) {
        changes.push('next action updated');
      }
      if (task_done) {
        changes.push('task completed');
      }
      if (changes.length > 0) {
        await s`
          INSERT INTO activity_log (tenant_id, ts, action, detail, result)
          VALUES (${tenantId()}, now(), 'crm', ${`lead:${id} ${changes.join(', ')}`}, NULL)
        `;
      }
    }
    await logAudit({
      actor,
      action: 'crm.lead.update',
      target: `lead:${id}`,
      detail: { updates: writebackUpdates },
    });
    return NextResponse.json({ ok: true, lead });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
