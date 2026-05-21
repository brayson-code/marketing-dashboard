// KeyWatch — real-time error capture + dedupe.
//
// Raw errors come in from three places (client error boundary / window hooks,
// the Next.js server `onRequestError` hook, and edge). We fingerprint each one
// so repeats collapse into a single `issue`, store the occurrence in
// `error_events`, and bump the issue's count/last_seen. On a brand-new issue (or
// one that had been resolved and is now happening again) we fire alerts.
//
// Backend path uses the `postgres` role (RLS-bypassing) so every query scopes to
// tenant_id explicitly.

import { createHash } from 'node:crypto';
import { sql, jsonb, DEFAULT_TENANT_ID } from './db/client';
import { notifyIssue } from './alerts';

export type IssueLevel = 'error' | 'warning' | 'fatal';
export type IssueSource = 'client' | 'server' | 'edge';
export type IssueStatus = 'triage' | 'assigned' | 'fix_proposed' | 'in_review' | 'resolved' | 'ignored';
export type IssuePriority = 'low' | 'med' | 'high' | 'urgent';

export interface CaptureInput {
  level?: IssueLevel;
  source: IssueSource;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  url?: string | null;
  route?: string | null;
  method?: string | null;
  userAgent?: string | null;
  release?: string | null;
  context?: Record<string, unknown> | null;
}

export interface IssueRow {
  id: string;
  tenant_id: string;
  fingerprint: string;
  title: string;
  level: IssueLevel;
  source: IssueSource;
  status: IssueStatus;
  priority: IssuePriority;
  count: number;
  route: string | null;
  sample_message: string | null;
  sample_stack: string | null;
  root_cause: string | null;
  suggested_fix: string | null;
  pr_url: string | null;
  assignee: string | null;
  task_id: number | null;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

// Normalize a message so "User 4821 not found" and "User 99 not found" group
// together: drop digits, hex addresses, uuids, quoted literals.
function normalizeMessage(msg: string): string {
  return (msg || 'Unknown error')
    .replace(/0x[0-9a-f]+/gi, '0xADDR')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
    .replace(/["'`][^"'`]*["'`]/g, 'STR')
    .replace(/\b\d+\b/g, 'N')
    .trim()
    .slice(0, 300);
}

// First meaningful stack frame (function + file, line numbers stripped) — the
// strongest signal for "same bug, same place".
function topFrame(stack?: string | null): string {
  if (!stack) return '';
  const line = stack
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ') || /\.(t|j)sx?:/.test(l));
  return (line ?? '').replace(/:\d+:\d+/g, '').slice(0, 200);
}

export function fingerprint(input: CaptureInput): string {
  const basis = `${input.source}|${normalizeMessage(input.message)}|${topFrame(input.stack)}`;
  return createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

function deriveTitle(input: CaptureInput): string {
  const first = (input.message || 'Unknown error').split('\n')[0].trim();
  return first.slice(0, 160);
}

export interface CaptureResult {
  issueId: string;
  isNew: boolean;
  reopened: boolean;
  count: number;
  status: IssueStatus;
}

/**
 * Record an error occurrence, deduping into an issue. Never throws — capture
 * must not be able to take down the thing it's observing.
 */
export async function captureError(input: CaptureInput): Promise<CaptureResult | null> {
  try {
    const fp = fingerprint(input);
    const level = input.level ?? 'error';
    const title = deriveTitle(input);

    // Upsert the issue and learn whether it's new / was previously resolved, in
    // one round-trip. xmax = 0 means the row was inserted by this statement.
    const rows = (await sql()`
      WITH prev AS (
        SELECT status FROM public.issues
        WHERE tenant_id = ${DEFAULT_TENANT_ID} AND fingerprint = ${fp}
      ), ins AS (
        INSERT INTO public.issues
          (tenant_id, fingerprint, title, level, source, route, sample_message, sample_stack)
        VALUES
          (${DEFAULT_TENANT_ID}, ${fp}, ${title}, ${level}, ${input.source},
           ${input.route ?? null}, ${input.message.slice(0, 2000)}, ${input.stack?.slice(0, 6000) ?? null})
        ON CONFLICT (tenant_id, fingerprint) DO UPDATE
          SET count = public.issues.count + 1,
              last_seen = now(),
              updated_at = now(),
              level = ${level},
              sample_stack = COALESCE(public.issues.sample_stack, EXCLUDED.sample_stack),
              status = CASE WHEN public.issues.status IN ('resolved','ignored')
                            THEN 'triage' ELSE public.issues.status END
        RETURNING id, count, status, (xmax = 0) AS is_new
      )
      SELECT ins.id, ins.count, ins.status, ins.is_new, prev.status AS prev_status
      FROM ins LEFT JOIN prev ON true
    `) as unknown as Array<{ id: string; count: number; status: IssueStatus; is_new: boolean; prev_status: IssueStatus | null }>;

    const r = rows[0];
    const issueId = r.id;

    await sql()`
      INSERT INTO public.error_events
        (tenant_id, issue_id, level, source, message, stack, component_stack, url, route, method, user_agent, release, context)
      VALUES
        (${DEFAULT_TENANT_ID}, ${issueId}, ${level}, ${input.source},
         ${input.message.slice(0, 4000)}, ${input.stack?.slice(0, 8000) ?? null},
         ${input.componentStack?.slice(0, 4000) ?? null}, ${input.url ?? null}, ${input.route ?? null},
         ${input.method ?? null}, ${input.userAgent?.slice(0, 400) ?? null}, ${input.release ?? null},
         ${input.context ? jsonb(input.context) : null})
    `;

    const isNew = !!r.is_new;
    const reopened = !isNew && (r.prev_status === 'resolved' || r.prev_status === 'ignored');

    // Alert only on the signal-bearing transitions, so we don't spam on every
    // repeat occurrence of a known issue.
    if (isNew || reopened) {
      await notifyIssue(
        { id: issueId, title, level, source: input.source, route: input.route ?? null, count: r.count },
        { isNew, reopened },
      );
    }

    return { issueId, isNew, reopened, count: r.count, status: r.status };
  } catch (err) {
    // Last resort: log to stderr so it shows in Vercel logs, but never rethrow.
    console.error('[keywatch] captureError failed:', (err as Error).message);
    return null;
  }
}

export interface ListIssuesOpts {
  status?: IssueStatus;
  limit?: number;
}

export async function listIssues(opts: ListIssuesOpts = {}): Promise<IssueRow[]> {
  const limit = Math.min(opts.limit ?? 200, 500);
  const rows = opts.status
    ? await sql()`
        SELECT * FROM public.issues
        WHERE tenant_id = ${DEFAULT_TENANT_ID} AND status = ${opts.status}
        ORDER BY last_seen DESC LIMIT ${limit}`
    : await sql()`
        SELECT * FROM public.issues
        WHERE tenant_id = ${DEFAULT_TENANT_ID}
        ORDER BY last_seen DESC LIMIT ${limit}`;
  return rows as unknown as IssueRow[];
}

export async function getIssue(id: string): Promise<IssueRow | null> {
  const rows = (await sql()`
    SELECT * FROM public.issues WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `) as unknown as IssueRow[];
  return rows[0] ?? null;
}

export interface ErrorEventRow {
  id: number;
  level: string;
  source: string;
  message: string;
  stack: string | null;
  component_stack: string | null;
  url: string | null;
  route: string | null;
  method: string | null;
  user_agent: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

export async function getIssueEvents(id: string, limit = 20): Promise<ErrorEventRow[]> {
  const rows = (await sql()`
    SELECT id, level, source, message, stack, component_stack, url, route, method, user_agent, context, created_at
    FROM public.error_events
    WHERE issue_id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY created_at DESC LIMIT ${limit}
  `) as unknown as ErrorEventRow[];
  return rows;
}

export async function updateIssue(
  id: string,
  fields: Partial<Pick<IssueRow, 'status' | 'priority' | 'assignee' | 'root_cause' | 'suggested_fix' | 'pr_url' | 'task_id'>>,
): Promise<IssueRow | null> {
  const resolvedAt = fields.status === 'resolved' ? new Date().toISOString() : null;
  const rows = (await sql()`
    UPDATE public.issues SET
      status        = COALESCE(${fields.status ?? null}, status),
      priority      = COALESCE(${fields.priority ?? null}, priority),
      assignee      = COALESCE(${fields.assignee ?? null}, assignee),
      root_cause    = COALESCE(${fields.root_cause ?? null}, root_cause),
      suggested_fix = COALESCE(${fields.suggested_fix ?? null}, suggested_fix),
      pr_url        = COALESCE(${fields.pr_url ?? null}, pr_url),
      task_id       = COALESCE(${fields.task_id ?? null}, task_id),
      resolved_at   = CASE WHEN ${fields.status ?? null} = 'resolved' THEN ${resolvedAt}::timestamptz ELSE resolved_at END,
      updated_at    = now()
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
    RETURNING *
  `) as unknown as IssueRow[];
  return rows[0] ?? null;
}
