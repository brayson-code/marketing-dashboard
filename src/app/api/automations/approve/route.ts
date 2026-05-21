import { NextRequest, NextResponse } from "next/server";
import { sql, DEFAULT_TENANT_ID } from "@/lib/db/client";
import { requireApiEditor } from "@/lib/api-auth";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const LEAD_APPROVED_STATUS = "approved";

export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  const actor = requireUser(req as Request);
  const body = await req.json();
  const { id, type, action } = body as {
    id: string;
    type: "content" | "email";
    action: "approve" | "reject";
  };

  if (!id || !type || !action) {
    return NextResponse.json({ error: "Missing id, type, or action" }, { status: 400 });
  }

  const s = sql();

  if (type === "content") {
    const newStatus = action === "approve" ? "ready" : "rejected";
    await s`
      UPDATE content_posts SET status = ${newStatus}
      WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID} AND status = 'pending_approval'
    `;
  } else if (type === "email") {
    const newStatus = action === "approve" ? "approved" : "cancelled";

    if (action === "approve") {
      const rows = await s`
        SELECT l.status as lead_status
        FROM sequences seq
        LEFT JOIN leads l ON l.id = seq.lead_id AND l.tenant_id = ${DEFAULT_TENANT_ID}
        WHERE seq.id = ${id} AND seq.tenant_id = ${DEFAULT_TENANT_ID}
      ` as unknown as { lead_status: string | null }[];
      const lead = rows[0];
      if (!lead || lead.lead_status !== LEAD_APPROVED_STATUS) {
        return NextResponse.json({ error: "Lead must be approved before email sequence approval" }, { status: 409 });
      }
    }

    await s`
      UPDATE sequences SET status = ${newStatus}
      WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID} AND status = 'pending_approval'
    `;
  }

  await s`
    INSERT INTO activity_log (tenant_id, ts, action, detail, result)
    VALUES (
      ${DEFAULT_TENANT_ID}, now(),
      ${action === "approve" ? "approve" : "reject"},
      ${`${action === "approve" ? "Approved" : "Rejected"} ${type}: ${id}`},
      ${action === "approve" ? "Moved to ready/approved" : "Rejected/cancelled"}
    )
  `;

  await logAudit({
    actor,
    action: "automation.approval",
    target: `${type}:${id}`,
    detail: { action },
  });
  return NextResponse.json({ ok: true, id, action });
}
