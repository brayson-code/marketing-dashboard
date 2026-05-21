import { runOrchestrator } from './orchestrator';
import { sendIMessage } from './loopmessage';
import { listActiveGoals, type Goal } from './goals';
import { listDrafts } from './drafts';
import { sql, jsonb, DEFAULT_TENANT_ID } from './db/client';

interface Signal {
  type: 'stalled_goal' | 'due_goal' | 'pending_draft' | 'long_task';
  detail: string;
  data?: Record<string, unknown>;
}

const DAY_SEC = 86_400;
const STALL_THRESHOLD_DAYS = 7;
const LONG_TASK_SEC = 300; // 5 min

function isoDaysAgo(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / (DAY_SEC * 1000));
}

function lastProgressDaysAgo(goal: Goal): number {
  if (!goal.progress.length) return isoDaysAgo(goal.created);
  return isoDaysAgo(goal.progress[goal.progress.length - 1].ts);
}

/**
 * Inspect current state and return triggers KeyPlayer should consider acting on.
 * Doesn't invoke the orchestrator — just gathers signals.
 */
export async function gatherSignals(): Promise<Signal[]> {
  const signals: Signal[] = [];

  for (const g of await listActiveGoals()) {
    if (g.due) {
      const days = isoDaysAgo(g.due);
      if (days >= 0) signals.push({ type: 'due_goal', detail: `${g.title} (due ${g.due})`, data: { id: g.id } });
    }
    if (lastProgressDaysAgo(g) >= STALL_THRESHOLD_DAYS && g.status === 'active') {
      signals.push({
        type: 'stalled_goal',
        detail: `${g.title} — no progress in ${lastProgressDaysAgo(g)} days`,
        data: { id: g.id },
      });
    }
  }

  const pendingDrafts = await listDrafts({ status: 'pending', limit: 100 });
  if (pendingDrafts.length > 0) {
    signals.push({
      type: 'pending_draft',
      detail: `${pendingDrafts.length} draft(s) awaiting your review`,
      data: { count: pendingDrafts.length, ids: pendingDrafts.map((d) => d.id) },
    });
  }

  const longTasks = (await sql()`
    SELECT id, agent_id, task, started_at FROM agent_tasks
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
      AND status = 'running'
      AND started_at < now() - make_interval(secs => ${LONG_TASK_SEC})
  `) as unknown as Array<{ id: number; agent_id: string; task: string; started_at: Date }>;
  for (const t of longTasks) {
    const runningMin = Math.floor((Date.now() - new Date(t.started_at).getTime()) / 60000);
    signals.push({
      type: 'long_task',
      detail: `${t.agent_id} task still running after ${runningMin} min`,
      data: { task_id: t.id },
    });
  }

  return signals;
}

export interface SweepResult {
  signals: Signal[];
  invoked: boolean;
  text?: string;
  error?: string;
}

/**
 * Run a proactive sweep. If signals are present, prompt KeyPlayer with them and
 * deliver any reply via iMessage. If no signals, no-op (quietly).
 */
export async function runProactiveSweep(): Promise<SweepResult> {
  const signals = await gatherSignals();
  if (signals.length === 0) return { signals: [], invoked: false };

  const summary = signals.map((s) => `- [${s.type}] ${s.detail}`).join('\n');
  const promptText = [
    'PROACTIVE SWEEP — internal trigger, not from owner.',
    'The following signals were just detected:',
    '',
    summary,
    '',
    'Decide whether each is worth pinging the owner about right now. Apply your soul.md notification thresholds. If yes, summarize the salient ones in ONE concise iMessage. If no signal is owner-worthy, reply with the literal text `NO_ACTION` and nothing else.',
  ].join('\n');

  await sql()`
    INSERT INTO boardroom_messages (tenant_id, direction, sender, text, status, metadata)
    VALUES (
      ${DEFAULT_TENANT_ID}, 'in', 'system', ${promptText}, 'proactive',
      ${jsonb({ source: 'proactive_sweep', signals })}
    )
  `;

  const result = await runOrchestrator();
  if (!result.ok) return { signals, invoked: true, error: result.error };

  const text = result.text.trim();
  if (text === 'NO_ACTION' || text.length === 0) {
    return { signals, invoked: true, text: '(KeyPlayer chose not to ping)' };
  }
  const send = await sendIMessage(text, { agent: 'keyplayer' });
  if (!send.ok) return { signals, invoked: true, text, error: send.error };
  return { signals, invoked: true, text };
}
