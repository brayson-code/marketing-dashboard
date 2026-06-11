// Trial Reel Generator — the orchestration glue that turns the live trend radar
// + competitor wins into a batch of fresh, testable reel CONCEPTS.
//
// generateIdeas() gathers the current TrendRadar (Task A's getTrendRadar), builds
// a compact ideation brief, spawns the reel-ideator (Haiku, TOOL-FREE — one cheap
// turn), parses the JSON array it returns defensively, and stores the concepts as
// 'proposed' ideas the client then curates.
//
// Tenant scoping is inherited: getTrendRadar / insertIdeas already scope
// tenant_id = tenantId(), so the caller just needs to be inside tenant context
// (enterTenant), which the API route establishes before calling in.

import { getTrendRadar } from '@/lib/trends';
import { spawnSubAgent } from './subagent';
import { ensureBundledAgentRow } from './agent-defs';
import { insertIdeas, type ReelIdea } from './reel-ideas';

// One raw concept as the reel-ideator emits it (before mapping to a ReelIdea).
interface RawIdea {
  hook?: unknown;
  angle?: unknown;
  format?: unknown;
  rides?: unknown;
  why?: unknown;
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// Pull the first balanced top-level `[ ... ]` block out of the agent's text and
// JSON.parse it. Strips any surrounding markdown / code fences first, then scans
// from the first '[' to its matching ']' (bracket-depth aware, string-aware) so a
// stray bracket inside a hook string can't truncate the array early. Returns []
// when there's nothing parseable — the caller decides whether that's an error.
function parseIdeaArray(text: string): RawIdea[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  if (start === -1) return [];

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return [];

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as RawIdea[]) : [];
  } catch {
    return [];
  }
}

// Build the ideation brief the reel-ideator works from: the focus (if any), the
// top trending tags, the analyst pulse, and a few competitor "wins" (top reels'
// captions/hooks). Kept compact — the agent is TOOL-FREE and cheap.
function buildIdeatorTask(
  radar: Awaited<ReturnType<typeof getTrendRadar>>,
  focus: string | undefined,
  count: number,
): string {
  const lines: string[] = [];
  lines.push(`Generate exactly ${count} fresh, testable reel concepts. Return ONLY a JSON array — no prose, no code fences.`);
  lines.push('');

  lines.push('## FOCUS');
  lines.push(focus?.trim() ? focus.trim() : '(none — range across the trends and wins below)');
  lines.push('');

  lines.push(`## TRENDS (last ${radar.windowDays}d, ${radar.analyzedCount} reels analyzed)`);
  if (radar.topTags.length > 0) {
    lines.push('Top trending tags (label · times winning):');
    for (const t of radar.topTags.slice(0, 8)) {
      lines.push(`- ${t.label} · ${t.count}`);
    }
  } else {
    lines.push('Top trending tags: (none yet)');
  }
  lines.push('');
  lines.push('Analyst pulse:');
  lines.push(radar.pulse?.trim() || '(no pulse yet)');
  lines.push('');

  lines.push('## COMPETITOR WINS (winning hooks/captions — signal only, never copy)');
  const wins = radar.topReels.slice(0, 6).filter((r) => (r.caption ?? '').trim().length > 0);
  if (wins.length > 0) {
    for (const r of wins) {
      const tags = r.tags?.length ? ` [${r.tags.join(', ')}]` : '';
      lines.push(`- "${(r.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}"${tags}`);
    }
  } else {
    lines.push('- (no competitor wins available — work from the trends + focus)');
  }

  return lines.join('\n');
}

/**
 * Generate a batch of fresh reel concepts from the live trend radar + competitor
 * wins, store them as 'proposed', and return the new batch. Throws a clear error
 * when the agent returns nothing parseable.
 */
export async function generateIdeas(input: { focus?: string; count?: number }): Promise<ReelIdea[]> {
  const count = Math.max(1, Math.min(input.count ?? 6, 12));
  const focus = input.focus?.trim() || undefined;

  // Gather the live trends + competitor wins (Task A owns getTrendRadar).
  const radar = await getTrendRadar();
  const task = buildIdeatorTask(radar, focus, count);

  // Ensure the reel-ideator agent_defs row exists so its definition (and any live
  // Agent Studio edits) resolve — same pattern reel-intel uses for reel-analyst.
  await ensureBundledAgentRow('reel-ideator');

  // Cheap by design: TOOL-FREE single Haiku turn (no web_search loop).
  const result = await spawnSubAgent('reel-ideator', task, undefined, { tools: 'none' });
  if (!result.ok || !result.text) {
    throw new Error(`reel-ideator failed: ${result.error ?? 'no text returned'}`);
  }

  // Parse the JSON array defensively; skip malformed entries (must have a hook).
  const raw = parseIdeaArray(result.text);
  const items = raw
    .map((r) => ({
      hook: asStr(r.hook),
      angle: asStr(r.angle),
      format: asStr(r.format),
      rationale: asStr(r.why),
      trend_tag: asStr(r.rides) || null,
    }))
    .filter((it) => it.hook.length > 0)
    .slice(0, count);

  if (items.length === 0) {
    throw new Error('reel-ideator returned no parseable ideas');
  }

  return insertIdeas(items);
}
