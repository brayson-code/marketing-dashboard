// find_clip — lets a sub-agent (e.g. the Hyperframes storyboard agent) pull a real
// movie/TV clip for a phrase and drop it straight into the media library, so it can
// reference it as scene b-roll. Same source as the manual "Movie clips" finder
// (PlayPhrase via headless browser, cached), so the agent and the user share one
// pipeline. Gated on MOVIE_CLIPS_ENABLED (offered only when the flag is on).

import Anthropic from '@anthropic-ai/sdk';
import { searchMovieClips, importMovieClip } from './playphrase';

export const CLIP_TOOL_NAMES = ['find_clip'] as const;

export function clipToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'find_clip',
      description:
        'Find a real movie/TV clip of a spoken phrase and add it to the media library as b-roll ' +
        '(recognizable faces/lines are a strong watch-time pattern-interrupt). Give the exact ' +
        'words said on screen, e.g. "I am your father" or "show me the money". Returns the ' +
        'matching clips; by default it imports the best match and returns its media asset id + ' +
        'name, which you can reference as a scene Clip in a storyboard. Set add=false to only ' +
        'preview matches without importing.',
      input_schema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'The exact spoken phrase to find (a real movie/TV line).' },
          add: { type: 'boolean', description: 'Import the top match into the media library. Default true.' },
          count: { type: 'number', description: 'How many matches to return (1–12). Default 5.' },
        },
      },
    },
  ];
}

export async function handleClipTool(
  toolUse: Anthropic.ToolUseBlock,
  _sourceAgent: string,
): Promise<Anthropic.ToolResultBlockParam> {
  const id = toolUse.id;
  if (toolUse.name !== 'find_clip') {
    return { type: 'tool_result', tool_use_id: id, content: `Unknown clip tool: ${toolUse.name}`, is_error: true };
  }
  if (process.env.MOVIE_CLIPS_ENABLED !== 'true') {
    return { type: 'tool_result', tool_use_id: id, content: 'find_clip: movie clips are not enabled.', is_error: true };
  }

  const input = (toolUse.input ?? {}) as { query?: string; add?: boolean; count?: number };
  const query = String(input.query ?? '').trim();
  if (!query) {
    return { type: 'tool_result', tool_use_id: id, content: 'find_clip: a `query` phrase is required.', is_error: true };
  }
  const add = input.add !== false; // default true
  const count = Number.isFinite(input.count) ? Math.min(Math.max(Number(input.count), 1), 12) : 5;

  try {
    const { clips } = await searchMovieClips(query, { limit: count });
    if (clips.length === 0) {
      return { type: 'tool_result', tool_use_id: id, content: `find_clip: no clips found for "${query}". Try a shorter, more common line.` };
    }

    const lines = clips.map((c, i) => `${i + 1}. "${c.text}" — ${c.movie || 'unknown'}`);
    let footer = '';
    if (add) {
      const asset = await importMovieClip({ videoUrl: clips[0].videoUrl, text: clips[0].text, movie: clips[0].movie });
      footer =
        `\n\nImported the top match into the media library as asset #${asset.id} ("${asset.name}"). ` +
        `Reference it as a scene Clip by that id or name.`;
    }
    return {
      type: 'tool_result',
      tool_use_id: id,
      content: `Found ${clips.length} clip(s) for "${query}":\n${lines.join('\n')}${footer}`,
    };
  } catch (e) {
    return {
      type: 'tool_result',
      tool_use_id: id,
      content: `find_clip failed: ${e instanceof Error ? e.message : 'unknown error'}`,
      is_error: true,
    };
  }
}
