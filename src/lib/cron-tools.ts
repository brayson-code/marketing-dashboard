// Cron agent tools — read the tenant's scheduled jobs + run history and, when
// explicitly enabled, create a new scheduled job.
//
// Mirrors jobber-tools.ts posture but is STRICTER because creating a recurring
// autonomous job is the riskiest write in the WIRE-NOW set:
//   - READ tools (list_cron_jobs / list_cron_runs) are always available.
//   - The WRITE tool (create_cron_job) is registered ONLY when
//     CRON_WRITE_ENABLED === 'true' (default OFF), AND it is added to
//     GATED_TOOLS so that — when TOOL_APPROVALS_ENABLED is on — KeyPlayer holds
//     it for owner step-up approval (like spawn_subagent / launch_campaign)
//     rather than creating the schedule directly. Only KeyPlayer gets the write
//     tool; sub-agents get reads only (the approval gate lives in the orchestrator).
//
// Cycle note: cron-store.ts imports SUBAGENT_REGISTRY from subagent.ts, and
// subagent.ts imports THIS module — so cron-store is imported LAZILY (dynamic
// import inside the functions), never at module load, to keep the graph acyclic.
//
// Wiring (see [[orchestrator-tool-wiring]]): CRON_TOOL_NAMES must be recognized in
// CLIENT_TOOL_NAMES, dispatched in handleClientToolUse, defined in buildTools, and
// mentioned in a prompt-awareness block — plus the subagent.ts filter + defs
// (reads only). Missing the CLIENT_TOOL_NAMES entry = silent "no text reply".

import Anthropic from '@anthropic-ai/sdk';
import { logAudit } from './audit';

export const CRON_READ_TOOL_NAMES = ['list_cron_jobs', 'list_cron_runs'] as const;
export const CRON_WRITE_TOOL_NAMES = ['create_cron_job'] as const;

// Recognized by CLIENT_TOOL_NAMES / the sub-agent filter regardless of the write
// flag — recognizing a name that's never registered is harmless; NOT recognizing a
// registered one bails the whole turn with no text reply.
export const CRON_TOOL_NAMES = new Set<string>([...CRON_READ_TOOL_NAMES, ...CRON_WRITE_TOOL_NAMES]);

/** Creating a recurring autonomous job is a WRITE — gated OFF by default. When off
 *  the tool is never registered and the prompt tells the agent it isn't enabled. */
export function cronWriteEnabled(): boolean {
  return process.env.CRON_WRITE_ENABLED === 'true';
}

export function cronToolDefinitions(opts?: { includeWrite?: boolean }): Anthropic.Messages.ToolUnion[] {
  const defs: Anthropic.Messages.ToolUnion[] = [
    {
      name: 'list_cron_jobs',
      description:
        'List the scheduled (cron) jobs for this workspace — recurring autonomous agent tasks. Read-only. Returns ' +
        "each job's id, name, the agent that runs it, its schedule, whether it's enabled, and its last run status.",
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'list_cron_runs',
      description: 'List recent run history for one scheduled job (status, duration, summary/error). Read-only.',
      input_schema: {
        type: 'object',
        required: ['job_id'],
        properties: {
          job_id: { type: 'string', description: 'The cron job id (from list_cron_jobs).' },
          limit: { type: 'number', description: 'Max runs to return (default 10, max 50).' },
        },
      },
    },
  ];

  if (opts?.includeWrite && cronWriteEnabled()) {
    defs.push({
      name: 'create_cron_job',
      description:
        'Create a NEW recurring scheduled job that runs a sub-agent on a cron schedule. This sets up standing ' +
        'autonomous work, so it may require owner approval before it takes effect. Provide a 5-field cron ' +
        'expression (e.g. "0 9 * * 1-5" = weekdays 9am) and the sub-agent + instruction to run.',
      input_schema: {
        type: 'object',
        required: ['id', 'agent_id', 'schedule', 'message'],
        properties: {
          id: { type: 'string', description: 'Short kebab-case job id, e.g. "daily-competitor-scan".' },
          name: { type: 'string', description: 'Optional human-friendly title.' },
          agent_id: { type: 'string', description: 'The sub-agent id that runs the job (e.g. research-analyst, content-writer). Must be a known sub-agent.' },
          schedule: { type: 'string', description: '5-field cron expression, e.g. "0 9 * * 1-5" (weekdays 9am), "0 18 * * *" (daily 6pm).' },
          tz: { type: 'string', description: 'IANA timezone (default UTC), e.g. America/New_York.' },
          message: { type: 'string', description: 'The full, self-contained instruction the agent runs each time.' },
        },
      },
    });
  }

  return defs;
}

// ── result helpers ──────────────────────────────────────────────────────────
function ok(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content };
}
function err(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content, is_error: true };
}

/**
 * Create a cron job from a create_cron_job tool input (the flat agent-facing shape).
 * Shared by BOTH the direct-execute handler and the approval-replay path in
 * pending-approvals.ts, so the mapping + validation live in exactly one place.
 * Throws on invalid input (createCronJob validates id / cron / agent / message) —
 * callers surface the message. Returns a short human-readable confirmation.
 */
export async function createCronJobFromToolInput(input: Record<string, unknown>, sourceAgent = 'keyplayer'): Promise<string> {
  const { createCronJob } = await import('./cron-store');
  const id = String(input.id ?? '').trim();
  const agentId = String(input.agent_id ?? '').trim();
  const expr = String(input.schedule ?? '').trim();
  const message = String(input.message ?? '').trim();
  const tz = typeof input.tz === 'string' && input.tz.trim() ? input.tz.trim() : 'UTC';
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined;

  await createCronJob({
    id,
    name,
    agentId,
    enabled: true,
    schedule: { expr, tz },
    payload: { message },
    delivery: {},
  });
  void logAudit({ actor: null, action: 'agent.cron.create', target: sourceAgent, detail: { id, agent_id: agentId, schedule: expr, tz } }).catch(() => {});
  return `Created scheduled job "${id}" — ${agentId} runs on "${expr}" (${tz}).`;
}

/**
 * Execute a cron tool_use block and return a tool_result. Never throws — a bad
 * input or failed query becomes an is_error tool_result. `sourceAgent` is recorded
 * on the create audit for provenance.
 */
export async function handleCronTool(
  toolUse: Anthropic.ToolUseBlock,
  sourceAgent = 'keyplayer',
): Promise<Anthropic.ToolResultBlockParam> {
  const id = toolUse.id;
  const input = (toolUse.input ?? {}) as Record<string, unknown>;

  try {
    switch (toolUse.name) {
      case 'list_cron_jobs': {
        const { listCronJobs } = await import('./cron-store');
        const jobs = await listCronJobs();
        if (jobs.length === 0) return ok(id, 'No scheduled jobs configured.');
        const lines = jobs.map((j) => {
          const last = j.state.lastStatus ? ` last=${j.state.lastStatus}` : '';
          return `- ${j.id}${j.name ? ` "${j.name}"` : ''} — agent=${j.agentId ?? '—'} "${j.schedule.expr ?? '?'} ${j.schedule.tz ?? 'UTC'}" enabled=${j.enabled}${last}`;
        });
        return ok(id, `${jobs.length} scheduled job(s):\n${lines.join('\n')}`);
      }
      case 'list_cron_runs': {
        const jobId = String(input.job_id ?? '').trim();
        if (!jobId) return err(id, 'list_cron_runs: `job_id` is required.');
        const limitN = Number(input.limit);
        const limit = Number.isFinite(limitN) && limitN > 0 ? Math.min(Math.floor(limitN), 50) : 10;
        const { listRuns } = await import('./cron-store');
        const runs = await listRuns(jobId, limit);
        if (runs.length === 0) return ok(id, `No runs recorded for job "${jobId}".`);
        const lines = runs.map((r) => {
          const dur = r.durationMs != null ? ` (${r.durationMs}ms)` : '';
          const tail = r.error ? ` — ERROR: ${r.error}` : r.summary ? ` — ${r.summary.slice(0, 120)}` : '';
          return `- ${r.ts} ${r.status}${dur}${tail}`;
        });
        return ok(id, `${runs.length} run(s) for "${jobId}":\n${lines.join('\n')}`);
      }
      case 'create_cron_job': {
        if (!cronWriteEnabled()) {
          return err(id, 'create_cron_job is not enabled in this workspace.');
        }
        const summary = await createCronJobFromToolInput(input, sourceAgent);
        return ok(id, summary);
      }
      default:
        return err(id, `Unknown cron tool: ${toolUse.name}`);
    }
  } catch (e) {
    return err(id, `${toolUse.name} failed: ${(e as Error).message}`);
  }
}
