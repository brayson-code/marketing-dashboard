// The Fixer — an autonomous debugging sub-agent. Given a KeyWatch issue, it
// reads the relevant repo files (via the GitHub API), pinpoints the root cause,
// and proposes a minimal patch. With GitHub configured it opens a *draft* PR for
// human review (never auto-merges); without it, it records the proposed patch on
// the issue so a developer can apply it.
//
// It runs entirely from serverless (no checkout) using the GitHub REST API.

import Anthropic from '@anthropic-ai/sdk';
import { sql, tenantId } from './db/client';
import { getIssue, getIssueEvents, updateIssue, saveProposedPatch } from './observability';
import { startTask, finishTask } from './agent-tasks';
import { sendSlack, isSlackConfigured } from './alerts';
import { sendIMessage, isLoopMessageConfigured } from './loopmessage';
import { createNotification } from './notifications';
import {
  isGitHubConfigured, getFileContent, createBranch, putFile, openPullRequest, defaultBranch, writeRepo,
} from './github';

const MODEL = 'claude-sonnet-4-6';
const MAX_FILES = 6;
const MAX_FILE_BYTES = 200_000;

const SYSTEM = `You are KeyPlayers' Fixer agent — a senior engineer who debugs production errors in a Next.js 16 (App Router) + TypeScript + Supabase codebase.

You are given a KeyWatch issue (a deduped production error with stack trace). Your job:
1. From the stack trace + error message, hypothesize which file(s) are responsible.
2. Use read_repo_file to read those files (read before you patch — never guess file contents).
3. Determine the root cause.
4. Produce a MINIMAL, surgical patch that fixes the root cause without unrelated refactors.
5. Call propose_patch exactly once with the complete new contents of each file you change.

Rules:
- Read a file before patching it. Provide the FULL new file content in propose_patch (not a diff).
- Keep changes minimal and consistent with the surrounding code style.
- Prefer defensive fixes (null/array guards, error handling) when the stack shows a runtime type error.
- If you genuinely cannot locate the cause from the available files, call propose_patch with an empty files array and explain what you'd need.
- Never include secrets. Never touch .env files, lockfiles, or migrations unless the bug is clearly there.`;

function tools(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'read_repo_file',
      description: 'Read the current contents of a file in the repository (from the default branch). Use repo-relative paths like "src/lib/foo.ts".',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Repo-relative path, e.g. src/app/page.tsx' } },
        required: ['path'],
      },
    },
    {
      name: 'propose_patch',
      description: 'Submit your fix. Provide root_cause, a short summary, and the complete new content for each changed file. Call exactly once when ready.',
      input_schema: {
        type: 'object',
        properties: {
          root_cause: { type: 'string', description: 'One-paragraph explanation of why the error happens.' },
          summary: { type: 'string', description: 'What the patch changes, in 1-3 sentences.' },
          files: {
            type: 'array',
            description: 'Files to change, each with full new content. Empty if you could not produce a fix.',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                new_content: { type: 'string', description: 'The COMPLETE new file content.' },
              },
              required: ['path', 'new_content'],
            },
          },
        },
        required: ['root_cause', 'summary', 'files'],
      },
    },
  ];
}

interface ProposedFile { path: string; new_content: string }
interface PatchProposal { root_cause: string; summary: string; files: ProposedFile[] }

function safePath(p: string): boolean {
  const clean = p.replace(/^\/+/, '');
  if (clean.includes('..')) return false;
  if (clean.startsWith('.env')) return false;
  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(clean)) return false;
  return clean.length > 0;
}

export interface FixerResult {
  ok: boolean;
  status?: 'in_review' | 'fix_proposed';
  prUrl?: string;
  error?: string;
}

export async function runFixer(issueId: string): Promise<FixerResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };

  const issue = await getIssue(issueId);
  if (!issue) return { ok: false, error: 'Issue not found' };

  const events = await getIssueEvents(issueId, 5);
  await updateIssue(issueId, { status: 'assigned', assignee: 'fixer' });

  const taskId = await startTask('fixer', `Fix issue: ${issue.title}`.slice(0, 200));
  await updateIssue(issueId, { task_id: taskId });

  const eventDump = events
    .map((e, i) => `--- occurrence ${i + 1} (${e.source}) ---\n${e.message}\n${(e.stack ?? '').slice(0, 2500)}${e.component_stack ? `\ncomponent stack:\n${e.component_stack.slice(0, 1500)}` : ''}`)
    .join('\n\n');

  const userMsg = `# KeyWatch issue
Title: ${issue.title}
Level: ${issue.level} · Source: ${issue.source}${issue.route ? ` · Route: ${issue.route}` : ''}
Seen ${issue.count}× (first ${issue.first_seen}, last ${issue.last_seen})

## Sample stack
${(issue.sample_stack ?? '(none)').slice(0, 4000)}

## Recent occurrences
${eventDump || '(no detailed events)'}

Diagnose and propose a minimal fix.`;

  const client = new Anthropic({ maxRetries: 5 });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMsg }];
  let proposal: PatchProposal | null = null;
  let filesRead = 0;
  let totalInput = 0;
  let totalOutput = 0;

  try {
    let response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: tools(),
      messages,
    });
    totalInput += response.usage.input_tokens; totalOutput += response.usage.output_tokens;

    let safety = 0;
    while (safety++ < 12) {
      if (response.stop_reason !== 'tool_use') break;

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) break;
      messages.push({ role: 'assistant', content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (tu.name === 'read_repo_file') {
          const path = String((tu.input as { path?: string }).path ?? '');
          if (!safePath(path)) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Refused: invalid or disallowed path.', is_error: true });
            continue;
          }
          if (++filesRead > 12) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'File read budget exhausted — proceed to propose_patch with what you have.', is_error: true });
            continue;
          }
          if (!isGitHubConfigured()) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'GitHub not configured — cannot read repo. Propose a patch from the stack trace alone, describing the change in new_content as best you can.', is_error: true });
            continue;
          }
          try {
            const file = await getFileContent(path, defaultBranch());
            results.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: file ? `// ${path}\n${file.text.slice(0, MAX_FILE_BYTES)}` : `File not found: ${path}`,
              is_error: !file,
            });
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Read failed: ${(err as Error).message}`, is_error: true });
          }
        } else if (tu.name === 'propose_patch') {
          const input = tu.input as PatchProposal;
          proposal = {
            root_cause: String(input.root_cause ?? ''),
            summary: String(input.summary ?? ''),
            files: Array.isArray(input.files)
              ? input.files
                  .filter((f) => f && safePath(f.path) && typeof f.new_content === 'string' && f.new_content.length < MAX_FILE_BYTES)
                  .slice(0, MAX_FILES)
              : [],
          };
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Patch received.' });
        } else {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true });
        }
      }

      messages.push({ role: 'user', content: results });
      if (proposal) break; // got the patch — stop the loop

      response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: tools(),
        messages,
      });
      totalInput += response.usage.input_tokens; totalOutput += response.usage.output_tokens;
    }

    if (!proposal) {
      await finishTask(taskId, { status: 'error', error: 'Fixer produced no patch proposal', inputTokens: totalInput, outputTokens: totalOutput });
      await updateIssue(issueId, { status: 'triage' });
      return { ok: false, error: 'No patch proposed' };
    }

    // Persist the diagnosis on the issue regardless of PR outcome.
    const patchText = proposal.files
      .map((f) => `### ${f.path}\n\n\`\`\`\n${f.new_content.slice(0, 4000)}\n\`\`\``)
      .join('\n\n');

    if (proposal.files.length === 0) {
      await updateIssue(issueId, { status: 'triage', root_cause: proposal.root_cause, suggested_fix: proposal.summary });
      await finishTask(taskId, { status: 'done', result: `Could not patch: ${proposal.summary}`, inputTokens: totalInput, outputTokens: totalOutput });
      return { ok: false, error: 'Fixer could not produce a code change; diagnosis saved to the issue.' };
    }

    // Save the diagnosis + structured patch immediately so it's preserved and an
    // "Approve" action can apply it later, even if the PR step fails now (e.g. a
    // read-only GitHub token).
    await updateIssue(issueId, {
      status: 'fix_proposed',
      root_cause: proposal.root_cause,
      suggested_fix: `${proposal.summary}\n\n${patchText}`,
    });
    await saveProposedPatch(issueId, proposal.files);

    let prUrl: string | undefined;
    let status: 'in_review' | 'fix_proposed' = 'fix_proposed';
    let prNote = '';

    if (isGitHubConfigured()) {
      try {
        prUrl = await openFixPr({ issueId, issueTitle: issue.title, files: proposal.files, rootCause: proposal.root_cause, summary: proposal.summary });
        status = 'in_review';
        await updateIssue(issueId, { status, suggested_fix: proposal.summary, pr_url: prUrl });
      } catch (prErr) {
        // Most common cause: token lacks push/PR write (read-only). Keep the
        // proposed patch on the issue so "Approve" can retry with a write token.
        prNote = ` (PR not opened — ${(prErr as Error).message.slice(0, 120)})`;
        console.error('[fixer] PR step failed, kept proposed patch:', (prErr as Error).message);
      }
    }

    await finishTask(taskId, { status: 'done', result: prUrl ? `Opened draft PR: ${prUrl}` : `Proposed patch (${proposal.files.length} file(s))${prNote}`, inputTokens: totalInput, outputTokens: totalOutput });

    // Tell the owner a fix is ready to review.
    const link = prUrl ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://keyplayers-command-center-woad.vercel.app'}/issues/${issueId}`;
    const msg = `🛠️ Fix proposed for: ${issue.title}\n${proposal.summary}\n${link}`;
    const fanout: Promise<unknown>[] = [
      createNotification({ type: 'custom', severity: 'info', title: 'Fix proposed', message: issue.title.slice(0, 120), data: { source: 'keywatch', issue_id: issueId, pr_url: prUrl ?? null } }),
    ];
    if (isSlackConfigured()) fanout.push(sendSlack(msg));
    if (isLoopMessageConfigured()) fanout.push(sendIMessage(msg, { agent: 'fixer' }));
    await Promise.allSettled(fanout);

    return { ok: true, status, prUrl };
  } catch (err) {
    const m = err instanceof Anthropic.APIError ? `Anthropic ${err.status}: ${err.message}` : (err as Error).message;
    await finishTask(taskId, { status: 'error', error: m, inputTokens: totalInput, outputTokens: totalOutput });
    await updateIssue(issueId, { status: 'triage' });
    return { ok: false, error: m };
  }
}

// Create a branch, commit the proposed files, and open a draft PR. Throws on
// failure (e.g. read-only token). Reused by runFixer and the Approve action.
export async function openFixPr(input: {
  issueId: string;
  issueTitle: string;
  files: ProposedFile[];
  rootCause: string;
  summary: string;
}): Promise<string> {
  const { issueId, issueTitle, files, rootCause, summary } = input;
  if (files.length === 0) throw new Error('No files to commit');
  const branch = `keywatch/fix-${issueId.slice(0, 8)}-${Date.now().toString(36)}`;
  await createBranch(branch);
  for (const f of files) {
    if (!safePath(f.path) || typeof f.new_content !== 'string') continue;
    // sha must be the file's blob on the WRITE repo (the fork) we're committing to.
    const existing = await getFileContent(f.path, defaultBranch(), writeRepo());
    await putFile(f.path, f.new_content, branch, `fix: ${summary.slice(0, 60)} (issue ${issueId.slice(0, 8)})`, existing?.sha);
  }
  const pr = await openPullRequest({
    head: branch,
    title: `fix: ${issueTitle.slice(0, 72)}`,
    draft: true,
    body: `**KeyWatch fix (draft — review before merge)**\n\n**Issue:** ${issueTitle}\n**Root cause:** ${rootCause}\n\n**Change:** ${summary}\n\nFiles changed:\n${files.map((f) => `- \`${f.path}\``).join('\n')}\n\n_Generated by the Fixer agent. Verify locally before merging._`,
  });
  return pr.url;
}

// Helper for surfacing config status to the UI.
export function fixerCapabilities() {
  return { github: isGitHubConfigured(), slack: isSlackConfigured(), imessage: isLoopMessageConfigured() };
}
