import { sql, jsonb, tenantId } from './db/client';

// Supabase-backed notification creator. Kept in its own module (free of any
// better-sqlite3 import) so serverless functions like the LoopMessage/Telegram
// webhooks can use it without dragging the native sqlite module into their bundle.
export async function createNotification(data: {
  type: string;
  severity?: string;
  title?: string;
  message: string;
  data?: Record<string, unknown>;
}): Promise<number> {
  const rows = await sql()`
    INSERT INTO notifications (tenant_id, type, severity, title, message, data)
    VALUES (
      ${tenantId()}, ${data.type}, ${data.severity || 'info'},
      ${data.title || null}, ${data.message}, ${data.data ? jsonb(data.data) : null}
    )
    RETURNING id
  `;
  return Number(rows[0].id);
}
