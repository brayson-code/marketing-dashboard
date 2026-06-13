/**
 * Pure helper: merges heterogeneous CRM timeline sources into a unified,
 * chronologically sorted array. All heavy DB work stays in the route; this
 * module only handles the merge / shape conversion so it can be unit-tested
 * without a database.
 */

export type TimelineKind =
  | 'outreach_sent'
  | 'outreach_pending'
  | 'outreach_approved'
  | 'outreach_cancelled'
  | 'outreach_queued'
  | 'inbound_email'
  | 'note'
  | 'status_change'
  | 'discovery';

export interface UnifiedTimelineItem {
  /** Monotonically incrementing id assigned during merge. */
  id: number;
  at: string; // ISO-8601
  kind: TimelineKind;
  label: string;
  detail: string;
}

// ─── Source row shapes (mirrors DB column subsets) ─────────────────────────────

export interface SequenceRow {
  id: string;
  step: number | null;
  subject: string | null;
  status: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface ActivityRow {
  ts: string;
  detail: string;
}

export interface InboundEmailRow {
  received_at: string;
  from_addr: string;
  subject: string | null;
  body_text: string | null;
}

// ─── Merge ────────────────────────────────────────────────────────────────────

export function mergeTimeline(
  sequences: SequenceRow[],
  activityRows: ActivityRow[],
  inboundEmails: InboundEmailRow[],
  leadCreatedAt: string | null,
  leadSource: string | null,
): UnifiedTimelineItem[] {
  const items: Omit<UnifiedTimelineItem, 'id'>[] = [];

  // 1. Sequence steps
  for (const seq of sequences) {
    const stepLabel = seq.step != null ? `Step ${seq.step}` : 'Step';
    const subject = seq.subject || 'No subject';

    if (seq.sent_at) {
      items.push({
        at: seq.sent_at,
        kind: 'outreach_sent',
        label: `Email sent`,
        detail: `${stepLabel}: "${subject}"`,
      });
    }

    // Only add non-sent status items if not already covered by sent_at
    if (!seq.sent_at) {
      if (seq.status === 'pending_approval') {
        items.push({
          at: seq.created_at,
          kind: 'outreach_pending',
          label: 'Awaiting approval',
          detail: `${stepLabel}: "${subject}"`,
        });
      } else if (seq.status === 'approved') {
        items.push({
          at: seq.created_at,
          kind: 'outreach_approved',
          label: 'Email approved',
          detail: `${stepLabel}: "${subject}"`,
        });
      } else if (seq.status === 'queued') {
        items.push({
          at: seq.created_at,
          kind: 'outreach_queued',
          label: 'Email queued',
          detail: `${stepLabel}: "${subject}"`,
        });
      } else if (seq.status === 'cancelled') {
        items.push({
          at: seq.created_at,
          kind: 'outreach_cancelled',
          label: 'Email cancelled',
          detail: `${stepLabel}: "${subject}"`,
        });
      }
    }
  }

  // 2. Inbound emails (contact replied via email)
  for (const msg of inboundEmails) {
    const subj = msg.subject ? `"${msg.subject}"` : 'no subject';
    const preview = msg.body_text
      ? msg.body_text.slice(0, 120).replace(/\s+/g, ' ').trim()
      : '';
    items.push({
      at: msg.received_at,
      kind: 'inbound_email',
      label: `Reply received`,
      detail: preview ? `${subj} — ${preview}` : subj,
    });
  }

  // 3. Activity log entries
  for (const row of activityRows) {
    // Heuristically classify: status changes vs notes
    const kind: TimelineKind = row.detail.includes('status:')
      ? 'status_change'
      : 'note';
    items.push({
      at: row.ts,
      kind,
      label: kind === 'status_change' ? 'Status updated' : 'Note',
      detail: row.detail,
    });
  }

  // 4. Lead discovery (oldest item)
  if (leadCreatedAt) {
    items.push({
      at: leadCreatedAt,
      kind: 'discovery',
      label: 'Lead discovered',
      detail: leadSource ? `via ${leadSource}` : 'source unknown',
    });
  }

  // Sort newest-first, then assign stable ids
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return items.map((item, idx) => ({ ...item, id: idx + 1 }));
}
