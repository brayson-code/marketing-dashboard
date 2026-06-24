// Firecrawl agent tool — scrape_brand pulls a public webpage's brand identity
// (name, tagline, palette, fonts, logo, socials) + clean markdown via Firecrawl
// (src/lib/firecrawl.ts).
//
// Mirrors sms-tools.ts / google-tools.ts. The tool is offered to an agent ONLY
// when a Firecrawl key is connected (firecrawlAllowed → getFirecrawlKey resolves
// non-null); the connection itself is the opt-in — no env flag, same as Apify.
// The handler never throws out of the tool-use loop and never leaks the key.
//
// Wiring (see [[orchestrator-tool-wiring]]): FIRECRAWL_TOOL_NAMES must be added in
// FOUR places for KeyPlayer — buildTools defs, CLIENT_TOOL_NAMES, the
// handleClientToolUse dispatch, and a prompt-awareness block — plus the
// subagent.ts filter + defs. Missing the CLIENT_TOOL_NAMES one yields
// "Orchestrator produced no text reply" and the tool silently never runs.

import Anthropic from '@anthropic-ai/sdk';
import { getFirecrawlKey, scrapeBrand, type BrandProfile } from './firecrawl';

export const FIRECRAWL_TOOL_NAMES = new Set<string>(['scrape_brand']);

/** True when this tenant has a Firecrawl key (pasted in Connections or env
 *  fallback). The connection is the opt-in. */
export async function firecrawlAllowed(): Promise<boolean> {
  try {
    return (await getFirecrawlKey()) !== null;
  } catch {
    return false;
  }
}

/** Anthropic tool defs for the Firecrawl brand scraper. Returns [] when no key is
 *  connected so the tool is never offered to the model. */
export async function firecrawlToolDefinitions(): Promise<Anthropic.Messages.ToolUnion[]> {
  if (!(await firecrawlAllowed())) return [];
  return [
    {
      name: 'scrape_brand',
      description:
        'Scrape ANY public website and extract its brand identity — name, tagline, ' +
        'description, primary colors (hex), fonts, logo URL, and social links — plus ' +
        'clean markdown of the main content. Use this to ground brand, design, or ' +
        'competitive work in the real source rather than guessing: a competitor’s site, ' +
        'a prospect’s homepage, or the workspace’s own marketing page. Returns a concise ' +
        'brand summary and a markdown excerpt.',
      input_schema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: {
            type: 'string',
            description: 'The full public http(s) URL to scrape (e.g. https://example.com).',
          },
          focus: {
            type: 'string',
            description:
              'Optional hint for what to pay attention to (e.g. "pricing voice", "color palette"). Currently advisory only.',
          },
        },
      },
    },
  ];
}

function ok_result(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content };
}

function err_result(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content, is_error: true };
}

/** Build a concise, model-friendly summary of a scraped brand. */
function summarize(b: BrandProfile): string {
  const lines: string[] = [];
  lines.push(`Brand scrape — ${b.url}`);
  if (b.name) lines.push(`Name: ${b.name}`);
  if (b.tagline) lines.push(`Tagline: ${b.tagline}`);
  if (b.description) lines.push(`Description: ${b.description}`);
  if (b.colors.length) lines.push(`Colors: ${b.colors.slice(0, 8).join(', ')}`);
  if (b.fonts.length) lines.push(`Fonts: ${b.fonts.slice(0, 6).join(', ')}`);
  if (b.logoUrl) lines.push(`Logo: ${b.logoUrl}`);
  if (b.socials.length) lines.push(`Socials: ${b.socials.slice(0, 8).join(', ')}`);
  const excerpt = b.markdown.slice(0, 2000).trim();
  if (excerpt) {
    lines.push('');
    lines.push('Markdown excerpt:');
    lines.push(excerpt + (b.markdown.length > 2000 ? '\n…(truncated)' : ''));
  }
  return lines.join('\n');
}

/**
 * Execute a scrape_brand tool_use block and return a tool_result. Never throws —
 * a missing key becomes a clear "connect Firecrawl" message and any other error
 * becomes an is_error tool_result. Never leaks the API key.
 *
 * `sourceAgent` is accepted for parity with the other tool handlers (and so the
 * subagent dispatch can pass `type`); it isn't needed for this read-only tool.
 */
export async function handleFirecrawlTool(
  toolUse: Anthropic.ToolUseBlock,
  _sourceAgent = 'keyplayer',
): Promise<Anthropic.ToolResultBlockParam> {
  void _sourceAgent;
  const id = toolUse.id;
  if (!FIRECRAWL_TOOL_NAMES.has(toolUse.name)) {
    return err_result(id, `Unknown Firecrawl tool: ${toolUse.name}`);
  }
  const input = (toolUse.input ?? {}) as { url?: string; focus?: string };
  const url = String(input.url ?? '').trim();
  if (!url) {
    return err_result(id, 'scrape_brand: `url` is required.');
  }
  try {
    const brand = await scrapeBrand(url);
    return ok_result(id, summarize(brand));
  } catch (e) {
    const msg = (e as Error).message || 'unknown error';
    if (msg === 'connect_firecrawl') {
      return err_result(
        id,
        'scrape_brand is not available: no Firecrawl key is connected. Ask the owner to add a Firecrawl key under Connections (firecrawl.dev) to enable brand scraping.',
      );
    }
    return err_result(id, `scrape_brand failed: ${msg}`);
  }
}
