// Reading the operator audit trail — SERVER.
//
// Operator actions are logged under the HQ tenant (logAudit stamps tenantId(), and an
// operator acts FROM their own workspace), so this reads across tenants deliberately.
// Operator-gated callers only.

import { sql } from './db/client';
import { isOperatorAction, type AuditRow } from './operator-audit-catalog';

const TENANT_TARGET = /^tenant:([0-9a-f-]{36})$/i;

export async function listOperatorAudit(limit = 100): Promise<AuditRow[]> {
  const rows = (await sql()`
    SELECT id, ts, actor_username, action, target, detail
    FROM public.audit_log
    WHERE action LIKE 'workspace.%'
       OR action LIKE 'portal.%'
       OR action LIKE 'operator.%'
    ORDER BY ts DESC
    LIMIT ${Math.min(Math.max(limit, 1), 500)}
  `) as unknown as Array<Record<string, unknown>>;

  // Resolve tenant targets to names in ONE query rather than per row.
  const ids = [...new Set(
    rows.map(r => TENANT_TARGET.exec(String(r.target ?? ''))?.[1]).filter(Boolean) as string[],
  )];
  const names = new Map<string, string>();
  if (ids.length) {
    const found = (await sql()`
      SELECT id, name FROM public.tenants WHERE id = ANY(${ids}::uuid[])
    `) as unknown as Array<{ id: string; name: string }>;
    for (const t of found) names.set(String(t.id), t.name);
  }

  return rows
    .filter(r => isOperatorAction(String(r.action)))
    .map(r => {
      // detail is TEXT holding JSON. A row that predates a shape change, or was written
      // by something else, must not break the whole view.
      let detail: Record<string, unknown> | null = null;
      try {
        const parsed = typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail;
        if (parsed && typeof parsed === 'object') detail = parsed as Record<string, unknown>;
      } catch { /* shown without its detail rather than dropped */ }

      const tid = TENANT_TARGET.exec(String(r.target ?? ''))?.[1] ?? null;
      return {
        id: String(r.id),
        ts: new Date(r.ts as string).toISOString(),
        actor: (r.actor_username as string) ?? null,
        action: String(r.action),
        target: (r.target as string) ?? null,
        // A deleted workspace still shows something useful rather than a bare uuid.
        workspace: tid ? (names.get(tid) ?? 'a deleted workspace') : null,
        detail,
      };
    });
}
