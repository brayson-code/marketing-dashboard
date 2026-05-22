// "Is this still a problem?" — re-runs the Fixer's diagnostic reasoning against
// the CURRENT repo to judge whether a KeyWatch issue is still valid and whether a
// previously proposed patch still applies. Read-only: it reads files via the
// GitHub API (no checkout) and writes only the verdict back onto the issue —
// never the repo. Reuses the same read_repo_file pattern as the Fixer.

import Anthropic from '@anthropic-ai/sdk';
import { getIssue, getIssueEvents, saveRevalidation, type RevalidationVerdict } from './observability';
import { isGitHubConfigured, getFileContent, defaultBranch } from './github';

const MODEL = 'claude-sonnet-4-6';
const MAX_FILE_BYTES = 120_000;
const READ_BUDGET = 8;

const SYSTEM = `You are KeyPlayers' issue re-validator for a Next.js 16 (App Router) + TypeScript + Supabase codebase.

You are given a past production error (a KeyWatch issue) and, if one exists, a previously proposed fix. Read the CURRENT repository files and judge two things:
1. still_present — does the ORIGINAL error / root cause still apply to the current code? (yes / no / unclear)
2. patch_applies — does the previously proposed patch still apply cleanly: do the target files still exist and has the relevant code NOT already changed or been fixed? Use "na" if there is no proposed patch. (yes / no / na / unclear)

Rules:
- Read the relevant file(s) with read_repo_file before judging — never guess file contents. Start from the stack trace + the proposed patch's file paths.
- "no" for still_present means the code has changed such that this error can no longer occur (likely already fixed).
- Be conservative: if you can't read enough to be sure, use "unclear".
- Call emit_verdict exactly once with a concise rationale (2-4 sentences) and the files you actually checked.`;

function tools(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'read_repo_file',
      description: 'Read current contents of a repo file (default branch). Repo-relative paths like "src/lib/foo.ts".',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
    {
      name: 'emit_verdict',
      description: 'Report whether the issue is still present and whether the proposed patch still applies. Call exactly once.',
      input_schema: {
        type: 'object',
        properties: {
          still_present: { type: 'string', enum: ['yes', 'no', 'unclear'] },
          patch_applies: { type: 'string', enum: ['yes', 'no', 'na', 'unclear'] },
          rationale: { type: 'string', description: '2-4 sentence explanation grounded in what you read.' },
          checked_files: { type: 'array', items: { type: 'string' }, description: 'Repo paths you actually read.' },
        },
        required: ['still_present', 'patch_applies', 'rationale'],
      },
    },
  ];
}

function safePath(p: string): boolean {
  const clean = p.replace(/^\/+/, '');
  return clean.length > 0 && !clean.includes('..');
}

export async function revalidateIssue(issueId: string): Promise<{ ok: boolean; verdict?: RevalidationVerdict; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };

  const issue = await getIssue(issueId);
  if (!issue) return { ok: false, error: 'Issue not found' };
  const events = await getIssueEvents(issueId, 3);

  const patch = Array.isArray(issue.proposed_patch) ? issue.proposed_patch : [];
  const patchBlock = patch.length
    ? patch.map((f) => `- ${f.path}\n  intended new content (preview):\n  ${f.new_content.slice(0, 1200).replace(/\n/g, '\n  ')}`).join('\n')
    : '(no proposed patch on this issue — judge patch_applies as "na")';

  const eventDump = events
    .map((e, i) => `--- occurrence ${i + 1} ---\n${e.message}\n${(e.stack ?? '').slice(0, 1500)}`)
    .join('\n\n');

  const userMsg = `# KeyWatch issue (re-validate against current code)
Title: ${issue.title}
${issue.level} · ${issue.source}${issue.route ? ` · ${issue.route}` : ''} · seen ${issue.count}× (first ${issue.first_seen}, last ${issue.last_seen})

## Sample stack
${(issue.sample_stack ?? '(none)').slice(0, 3500)}

## Recorded root cause
${issue.root_cause ?? '(none)'}

## Previously proposed patch
${patchBlock}

## Recent occurrences
${eventDump || '(no detailed events)'}

Read the current files and decide if this is still a problem and whether the patch still applies.`;

  const client = new Anthropic({ maxRetries: 5 });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMsg }];
  let verdict: RevalidationVerdict | null = null;
  let reads = 0;

  try {
    let response = await client.messages.create({
      model: MODEL, max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: tools(), messages,
    });

    let safety = 0;
    while (safety++ < 10) {
      if (response.stop_reason !== 'tool_use') break;
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (toolUses.length === 0) break;
      messages.push({ role: 'assistant', content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (tu.name === 'read_repo_file') {
          const path = String((tu.input as { path?: string }).path ?? '');
          if (!safePath(path)) { results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Refused: invalid path.', is_error: true }); continue; }
          if (++reads > READ_BUDGET) { results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Read budget exhausted — emit_verdict now.', is_error: true }); continue; }
          if (!isGitHubConfigured()) { results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'GitHub not configured — cannot read current code; judge "unclear".', is_error: true }); continue; }
          try {
            const file = await getFileContent(path, defaultBranch());
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: file ? `// ${path}\n${file.text.slice(0, MAX_FILE_BYTES)}` : `File not found: ${path} (it may have been moved/deleted).`, is_error: !file });
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Read failed: ${(err as Error).message}`, is_error: true });
          }
        } else if (tu.name === 'emit_verdict') {
          const input = tu.input as Partial<RevalidationVerdict>;
          verdict = {
            still_present: (['yes', 'no', 'unclear'].includes(String(input.still_present)) ? input.still_present : 'unclear') as RevalidationVerdict['still_present'],
            patch_applies: (['yes', 'no', 'na', 'unclear'].includes(String(input.patch_applies)) ? input.patch_applies : (patch.length ? 'unclear' : 'na')) as RevalidationVerdict['patch_applies'],
            rationale: String(input.rationale ?? '').slice(0, 1200),
            checked_files: Array.isArray(input.checked_files) ? input.checked_files.map(String).slice(0, 12) : [],
            at: new Date().toISOString(),
          };
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Verdict received.' });
        } else {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
      if (verdict) break;

      response = await client.messages.create({
        model: MODEL, max_tokens: 1500,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: tools(), messages,
      });
    }

    if (!verdict) return { ok: false, error: 'Re-validation produced no verdict' };
    await saveRevalidation(issueId, verdict);
    return { ok: true, verdict };
  } catch (err) {
    const m = err instanceof Anthropic.APIError ? `Anthropic ${err.status}: ${err.message}` : (err as Error).message;
    return { ok: false, error: m };
  }
}
