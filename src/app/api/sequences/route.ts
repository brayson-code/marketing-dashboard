import { NextRequest, NextResponse } from "next/server";
import { getSequences, updateSequenceStatus } from "@/lib/queries";
import { writebackSequenceStatus } from "@/lib/writeback";
import { requireApiEditor, requireApiUser } from "@/lib/api-auth";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sql, tenantId } from "@/lib/db/client";

const LEAD_APPROVED_STATUS = "approved";
const ALLOWED_SEQUENCE_STATUSES = new Set(["approved", "cancelled", "queued", "sent", "pending_approval"]);

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  const { searchParams } = req.nextUrl;
  const real = searchParams.get("real") === "true";
  const sequences = await getSequences({
    status: searchParams.get("status") || undefined,
    lead_id: searchParams.get("lead_id") || undefined,
    excludeSeed: real,
  });
  return NextResponse.json(sequences);
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);
  const body = await req.json();
  const { id, status } = body;
  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }
  if (typeof status !== "string" || !ALLOWED_SEQUENCE_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid sequence status" }, { status: 400 });
  }

  if (status === "approved" || status === "queued" || status === "sent") {
    const rows = await sql()`
      SELECT l.status as lead_status
      FROM sequences s
      LEFT JOIN leads l ON l.id = s.lead_id AND l.tenant_id = ${tenantId()}
      WHERE s.id = ${id} AND s.tenant_id = ${tenantId()}
    ` as unknown as { lead_status: string | null }[];
    const lead = rows[0];
    if (!lead || lead.lead_status !== LEAD_APPROVED_STATUS) {
      return NextResponse.json({ error: "Lead must be approved before outreach can be sent, queued, or approved" }, { status: 409 });
    }
  }

  await updateSequenceStatus(id, status);
  writebackSequenceStatus(id, status);
  await logAudit({
    actor,
    action: "sequence.update_status",
    target: "sequence:" + id,
    detail: { status },
  });
  return NextResponse.json({ ok: true });
}
