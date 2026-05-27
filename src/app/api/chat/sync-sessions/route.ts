import { NextResponse } from 'next/server';
import { sql, jsonb, tenantId } from '@/lib/db/client';
import fs from 'fs';
import path from 'path';
import { requireApiUser } from '@/lib/api-auth';
import { getAgentIds } from '@/lib/agent-config';
import { getInstance, resolveOpenClawPaths } from '@/lib/instances';

function getInstanceId(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

interface SessionEntry {
  type: string;
  id: string;
  parentId?: string;
  timestamp: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string; thinking?: string; name?: string }>;
    timestamp?: number;
  };
}

/**
 * POST /api/chat/sync-sessions
 * Reads JSONL session transcripts and imports user<->agent conversation turns
 * into the messages table.
 *
 * NOTE: the `session_sync` offset-tracking table does not exist in Supabase, so
 * incremental sync state is no longer persisted. Idempotency is preserved by
 * comparing against the count of messages already stored for each conversation.
 */
export async function POST(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;

  const instance = getInstance(getInstanceId(request));
  const { agentsDir } = resolveOpenClawPaths(instance);

  const s = sql();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const agentIds = getAgentIds(instance.id);

  for (const agentId of agentIds) {
    const sessionsDir = path.join(agentsDir, agentId, 'sessions');
    if (!fs.existsSync(sessionsDir)) continue;

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));

    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      const sessionId = file.replace('.jsonl', '');
      const conversationId = `session:${instance.id}:${agentId}:${sessionId}`;

      try {
        // Read file content
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        const existingRows = await s`
          SELECT COUNT(*) as c FROM messages
          WHERE conversation_id = ${conversationId} AND tenant_id = ${tenantId()}
        ` as unknown as { c: string }[];
        const existingCount = Number(existingRows[0]?.c ?? 0);

        // Parse all message entries
        const messageEntries: Array<{ role: string; text: string; timestamp: string }> = [];

        for (const line of lines) {
          try {
            const entry: SessionEntry = JSON.parse(line);
            if (entry.type !== 'message' || !entry.message) continue;

            const { role, content: contentBlocks } = entry.message;

            if (role === 'user') {
              const textBlock = contentBlocks?.find((b) => b.type === 'text');
              if (textBlock?.text) {
                messageEntries.push({
                  role: 'user',
                  text: textBlock.text,
                  timestamp: entry.timestamp,
                });
              }
            } else if (role === 'assistant') {
              const textBlocks = contentBlocks?.filter((b) => b.type === 'text') || [];
              const combinedText = textBlocks
                .map((b) => b.text)
                .filter(Boolean)
                .join('\n\n');
              if (combinedText) {
                messageEntries.push({
                  role: 'assistant',
                  text: combinedText,
                  timestamp: entry.timestamp,
                });
              }
            }
          } catch {
            // Skip malformed lines
          }
        }

        // Only import entries beyond what we already have
        const toImport = messageEntries.slice(existingCount);

        if (toImport.length === 0) {
          skipped++;
          continue;
        }

        for (const entry of toImport) {
          const ts = new Date(entry.timestamp).toISOString();
          const fromAgent = entry.role === 'user' ? 'operator' : agentId;
          const toAgent = entry.role === 'user' ? agentId : 'operator';
          await s`
            INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type, metadata, created_at)
            VALUES (
              ${tenantId()}, ${conversationId}, ${fromAgent}, ${toAgent}, ${entry.text}, 'text',
              ${jsonb({ source: 'session_sync', session_id: sessionId, instance: instance.id })},
              ${ts}::timestamptz
            )
          `;
          imported++;
        }

        // Create notification for new session messages
        const agentLabel = agentId.charAt(0).toUpperCase() + agentId.slice(1);
        const firstUserMsg = toImport.find((e) => e.role === 'user');
        let title = `${agentLabel} session activity`;

        if (firstUserMsg) {
          const cronMatch = firstUserMsg.text.match(/\[cron:[\w-]+\s+([^\]]+)\]/);
          if (cronMatch) title = `${agentLabel}: ${cronMatch[1]}`;
          else if (firstUserMsg.text.startsWith('[Telegram')) title = `${agentLabel}: Telegram message`;
        }

        const lastResponse = [...toImport].reverse().find((e) => e.role === 'assistant');
        const preview = lastResponse ? lastResponse.text.slice(0, 120) : `${toImport.length} new messages`;

        await s`
          INSERT INTO notifications (tenant_id, type, severity, title, message, data)
          VALUES (
            ${tenantId()}, 'session', 'info', ${title}, ${preview},
            ${jsonb({ conversation_id: conversationId, agent_id: agentId, count: toImport.length, instance: instance.id })}
          )
        `;
      } catch (err) {
        errors.push(`${instance.id}/${agentId}/${file}: ${err}`);
      }
    }
  }

  return NextResponse.json({
    instance: instance.id,
    imported,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
    synced_at: new Date().toISOString(),
  });
}

/**
 * GET /api/chat/sync-sessions — status of sync.
 * The session_sync table does not exist in Supabase, so there is no persisted
 * sync state to return.
 */
export async function GET(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;
  // TODO(supabase-migration): session_sync table not yet modeled.
  return NextResponse.json({ sessions: [] });
}

export const dynamic = 'force-dynamic';
