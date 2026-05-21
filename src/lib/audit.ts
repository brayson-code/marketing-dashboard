import { sql, DEFAULT_TENANT_ID } from './db/client';
import type { User } from './auth';

export interface AuditEntry {
  actor: User | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  // audit_log.actor_id is a Supabase auth uuid (nullable). The legacy `User.id`
  // is a numeric SQLite id, NOT a Supabase uuid, so we don't map it here — we
  // record the username as text and leave actor_id null until the auth layer
  // is migrated. Pass a Supabase user id here once available.
  await sql()`
    INSERT INTO audit_log (tenant_id, actor_id, actor_username, action, target, detail)
    VALUES (
      ${DEFAULT_TENANT_ID}, ${null}, ${entry.actor?.username ?? null},
      ${entry.action}, ${entry.target ?? null},
      ${entry.detail ? JSON.stringify(entry.detail) : null}
    )
  `;
}
