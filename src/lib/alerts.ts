// Alert fan-out for KeyWatch issues: Slack (incoming webhook) + iMessage
// (LoopMessage) + in-app notification. Each channel is gated on its config and
// fails soft — an alert never throws into the capture path.

import { sendIMessage, isLoopMessageConfigured } from './loopmessage';
import { createNotification } from './notifications';

export interface IssueAlert {
  id: string;
  title: string;
  level: 'error' | 'warning' | 'fatal';
  source: 'client' | 'server' | 'edge';
  route: string | null;
  count: number;
}

// Where the dashboard lives, for deep links in alerts. Falls back to the known
// production URL, then localhost.
function appUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://keyplayers-command-center-woad.vercel.app';
}

export function isSlackConfigured(): boolean {
  return !!process.env.SLACK_WEBHOOK_URL;
}

/** Post a message to Slack via an incoming webhook. No-op if unconfigured. */
export async function sendSlack(text: string, blocks?: unknown[]): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, error: 'SLACK_WEBHOOK_URL not configured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blocks ? { text, blocks } : { text }),
    });
    if (!res.ok) return { ok: false, error: `Slack HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const LEVEL_EMOJI: Record<string, string> = { error: '🐞', warning: '⚠️', fatal: '🔥' };

/** Fan out a new/reopened issue to every configured channel. */
export async function notifyIssue(
  issue: IssueAlert,
  opts: { isNew: boolean; reopened: boolean },
): Promise<void> {
  const emoji = LEVEL_EMOJI[issue.level] ?? '🐞';
  const verb = opts.reopened ? 'reopened' : 'new';
  const where = issue.route ? ` · ${issue.route}` : '';
  const seen = issue.count > 1 ? ` · seen ${issue.count}×` : '';
  const link = `${appUrl()}/issues/${issue.id}`;
  const headline = `${emoji} ${verb} ${issue.level} (${issue.source})${where}${seen}`;
  const body = `${issue.title}`;

  // Run all channels in parallel; collect but don't throw on failures.
  const tasks: Promise<unknown>[] = [];

  if (isSlackConfigured()) {
    tasks.push(
      sendSlack(`${headline}\n${body}\n${link}`, [
        { type: 'header', text: { type: 'plain_text', text: `${emoji} ${verb === 'reopened' ? 'Reopened' : 'New'} issue`, emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: `*${body}*\n${issue.source} · ${issue.level}${where}${seen}` } },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in KeyWatch' }, url: link }] },
      ]),
    );
  }

  if (isLoopMessageConfigured()) {
    tasks.push(sendIMessage(`${headline}\n${body}\n${link}`, { agent: 'keywatch' }));
  }

  tasks.push(
    createNotification({
      type: 'custom',
      severity: issue.level === 'warning' ? 'warning' : 'error',
      title: `${verb === 'reopened' ? 'Reopened' : 'New'} issue: ${issue.title.slice(0, 80)}`,
      message: `${issue.source} · ${issue.level}${where}${seen}`,
      data: { source: 'keywatch', issue_id: issue.id, level: issue.level, route: issue.route },
    }),
  );

  await Promise.allSettled(tasks);
}
