// "Is this draft still needed?" — re-judges a pending/approved draft against the
// CURRENT state of the world: active goals + what's already been published/sent/
// approved (so duplicates get caught), and for product/proposal drafts, the current
// repo. Read-only: it reads context + (for proposals) repo files, and writes only the
// verdict back onto the draft — it never executes, sends, or publishes anything.
// Mirrors the structure of revalidateIssue() in ./revalidate.

import Anthropic from '@anthropic-ai/sdk';
import { getDraft, listDrafts, saveDraftRevalidation, type DraftRevalidation, type DraftRow } from './drafts';
import { listActiveGoals } from './goals';
import { isGitHubConfigured, getFileContent, defaultBranch } from './github';

const MODEL = 'claude-sonnet-4-6';
const MAX_FILE_BYTES = 100_000;
const READ_BUDGET = 6;

// Proposal-type drafts ('other'/'campaign') are usually about the product/repo, so
// they may benefit from reading current code to see if the change already happened.
const REPO_AWARE: ReadonlyArray<DraftRow['type']> = ['other', 'campaign'];

const SYSTEM = `You are KeyPlayers' draft triager. You decide whether a saved draft is STILL worth acting on, or whether it has gone stale / been superseded.

You are given one draft plus context: the owner's currently-active goals, and recent drafts that were already published/sent/approved. For product/proposal drafts you can also read the current repository.

Judge:
1. still_needed — should the owner still act on this draft? (yes / no / unclear)
   - "no" = the moment has passed, the goal it served is gone, or the work is already done elsewhere.
2. superseded — is this already covered by something already published/sent/approved, or already implemented in the repo? (true / false)

Rules:
- Ground every judgment in the provided context. For proposals, read the relevant file(s) with read_repo_file before deciding whether the change is already done — never guess file contents.
- Be conservative: if the context is insufficient to be sure, use "unclear" and superseded=false. Do NOT mark something stale just because it is old.
- A draft serving a still-active goal, not yet shipped, and not duplicated = still_needed "yes".
- Call emit_verdict exactly once with a concise rationale (2-4 sentences).`;

function tools(repoAware: boolean): Anthropic.Messages.ToolUnion[] {
  const t: Anthropic.Messages.ToolUnion[] = [];
  if (repoAware) {
    t.push({
      name: 'read_repo_file',
      description: 'Read current contents of a repo file (default branch). Repo-relative paths like "src/lib/foo.ts". Use to check whether a proposed change is already implemented.',
      input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    });
  }
  t.push({
    name: 'emit_verdict',
    description: 'Report whether this draft is still needed. Call exactly once.',
    input_schema: {
      type: 'object',
      properties: {
        still_needed: { type: 'string', enum: ['yes', 'no', 'unclear'] },
        superseded: { type: 'boolean', description: 'Already covered by something shipped/approved or already implemented.' },
        rationale: { type: 'string', description: '2-4 sentence explanation grounded in the provided context.' },
        checked_files: { type: 'array', items: { type: 'string' }, description: 'Repo paths you actually read (proposals only).' },
      },
      required: ['still_needed', 'superseded', 'rationale'],
    },
  });
  return t;
}

function safePath(p: string): boolean {
  const clean = p.replace(/^\/+/, '');
  return clean.length > 0 && !clean.includes('..');
}

function buildUserMessage(draft: DraftRow, goals: { title: string; status: string; success: string }[], siblings: DraftRow[]): string {
  const goalBlock = goals.length
    ? goals.map((g) => `- [${g.status}] ${g.title} — success: ${g.success}`).join('\n')
    : '(no active goals on record)';

  const siblingBlock = siblings.length
    ? siblings.map((s) => `- #${s.id} [${s.status}] ${s.title}`).join('\n')
    : '(none)';

  return `# Draft to triage
#${draft.id} · type=${draft.type} · status=${draft.status} · created ${new Date(draft.created_at).toISOString()}${draft.created_by ? ` · by ${draft.created_by}` : ''}
Title: ${draft.title}

## Draft content
${draft.payload.slice(0, 4000)}

## Owner's active goals (does this draft still serve one?)
${goalBlock}

## Recently shipped/approved drafts of the same type (is this a duplicate / already covered?)
${siblingBlock}

Decide whether this draft is still worth acting on.${REPO_AWARE.includes(draft.type) ? ' If it proposes a code/product change, read the relevant files to check it is not already implemented.' : ''}`;
}

export async function revalidateDraft(draftId: number): Promise<{ ok: boolean; verdict?: DraftRevalidation; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };

  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, error: 'Draft not found' };

  const repoAware = REPO_AWARE.includes(draft.type);
  const [activeGoals, shipped] = await Promise.all([
    listActiveGoals().catch(() => []),
    // Pull recent terminal-state drafts of the same type to detect duplication.
    listDrafts({ status: 'all', limit: 80 }).catch(() => [] as DraftRow[]),
  ]);
  const siblings = shipped
    .filter((d) => d.id !== draft.id && d.type === draft.type && ['published', 'sent', 'confirmed', 'approved'].includes(d.status))
    .slice(0, 12);

  const userMsg = buildUserMessage(
    draft,
    activeGoals.map((g) => ({ title: g.title, status: g.status, success: g.success })),
    siblings,
  );

  const client = new Anthropic({ maxRetries: 5 });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMsg }];
  let verdict: DraftRevalidation | null = null;
  let reads = 0;

  try {
    let response = await client.messages.create({
      model: MODEL, max_tokens: 1200,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: tools(repoAware), messages,
    });

    let safety = 0;
    while (safety++ < 8) {
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
          const input = tu.input as Partial<DraftRevalidation>;
          verdict = {
            still_needed: (['yes', 'no', 'unclear'].includes(String(input.still_needed)) ? input.still_needed : 'unclear') as DraftRevalidation['still_needed'],
            superseded: input.superseded === true,
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
        model: MODEL, max_tokens: 1200,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: tools(repoAware), messages,
      });
    }

    if (!verdict) return { ok: false, error: 'Re-validation produced no verdict' };
    await saveDraftRevalidation(draftId, verdict);
    return { ok: true, verdict };
  } catch (err) {
    const m = err instanceof Anthropic.APIError ? `Anthropic ${err.status}: ${err.message}` : (err as Error).message;
    return { ok: false, error: m };
  }
}
