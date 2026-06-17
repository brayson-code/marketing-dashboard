// fetch_url — lets a sub-agent pull live data from a public http(s) URL (a JSON
// API, an open-data endpoint, a page). This is what turns a "scrape this link"
// skill from instructions into something the agent can actually DO. web_search is
// for discovery; fetch_url is for hitting a known endpoint and reading the bytes.
//
// SSRF-guarded: public http(s) only — localhost / private / link-local / metadata
// hosts are refused, so an agent can never reach internal services. Response is
// size-capped and time-bounded. The handler never throws out of the tool loop.

import Anthropic from '@anthropic-ai/sdk';
import { logAudit } from './audit';

export const FETCH_TOOL_NAMES = ['fetch_url'] as const;

const MAX_CHARS = 60_000;
const TIMEOUT_MS = 12_000;

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

export function fetchToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'fetch_url',
      description:
        'Fetch the raw content of a PUBLIC http(s) URL — a JSON API, an open-data endpoint, ' +
        'a webpage — and return its text. Use this to pull live data from a known link (e.g. a ' +
        'city open-data permits API) when you need the actual current data, not a web search. ' +
        'Prefer a JSON/API endpoint over an HTML page when one exists. Returns up to ~60k chars; ' +
        'internal/private addresses are refused.',
      input_schema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'The full public http(s) URL to fetch (include query params).' },
        },
      },
    },
  ];
}

export async function handleFetchTool(
  toolUse: Anthropic.ToolUseBlock,
  sourceAgent: string,
): Promise<Anthropic.ToolResultBlockParam> {
  const id = toolUse.id;
  if (toolUse.name !== 'fetch_url') {
    return { type: 'tool_result', tool_use_id: id, content: `Unknown fetch tool: ${toolUse.name}`, is_error: true };
  }
  const raw = String((toolUse.input as { url?: string })?.url ?? '').trim();
  let url: URL;
  try { url = new URL(raw); } catch { return { type: 'tool_result', tool_use_id: id, content: 'fetch_url: not a valid URL.', is_error: true }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { type: 'tool_result', tool_use_id: id, content: 'fetch_url: only http/https URLs are allowed.', is_error: true };
  }
  if (isBlockedHost(url.hostname)) {
    return { type: 'tool_result', tool_use_id: id, content: 'fetch_url: that host is not allowed (internal/private addresses are blocked).', is_error: true };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'KeyPlayers-Agent/1.0', Accept: 'application/json, text/plain, text/html;q=0.9, */*;q=0.5' },
    });
    const ct = res.headers.get('content-type') || '';
    let body = await res.text();
    if (body.length > MAX_CHARS) body = body.slice(0, MAX_CHARS) + '\n…[truncated]';
    try { await logAudit({ actor: null, action: 'agent.fetch_url', target: url.hostname, detail: { agent: sourceAgent, status: res.status, bytes: body.length } }); } catch { /* best-effort */ }
    if (!res.ok) {
      return { type: 'tool_result', tool_use_id: id, content: `fetch_url: HTTP ${res.status} from ${url.hostname}.\n${body.slice(0, 2000)}`, is_error: true };
    }
    return { type: 'tool_result', tool_use_id: id, content: `URL: ${url.toString()}\nContent-Type: ${ct}\n\n${body}` };
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s` : (e as Error).message;
    return { type: 'tool_result', tool_use_id: id, content: `fetch_url failed: ${msg}`, is_error: true };
  } finally {
    clearTimeout(timer);
  }
}
