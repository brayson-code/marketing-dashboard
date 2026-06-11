// Parse the hyperframes-agent's markdown output (see
// agents/sub-agents/hyperframes-agent/agent.md "Output schema") into a structured
// storyboard the UI can render as scene cards. Pure + dependency-free so it runs
// on the client. Tolerant by design: the agent's markdown drifts, so every field
// is optional and `parsed` tells the caller whether we found real structure (if
// not, the UI falls back to showing the raw markdown).

export interface StoryboardScene {
  time: string;
  visual: string;
  onScreenText: string;
  audio: string;
  /** Optional reference to a real Media-library clip (asset id or name). */
  clip?: string;
}

export interface Storyboard {
  platform?: string;
  length?: string;
  aspect?: string;
  hook?: { onScreenText?: string; visual?: string; audio?: string; clip?: string };
  scenes: StoryboardScene[];
  cta?: { onScreenText?: string; visual?: string; clip?: string };
  production?: { music?: string; pacing?: string; broll?: string; hyperframesPrompt?: string };
  risks?: string[];
  /** True when we recognized a hook, scenes, or platform — i.e. real storyboard structure. */
  parsed: boolean;
}

// Strip inline markdown the agent sometimes emits (**bold**, `code`, *italic*)
// plus wrapping quotes/whitespace, so scene cards read as plain prose.
function clean(s: string): string {
  return s.replace(/[`*]/g, '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
}

// Group lines under their nearest markdown heading (## …), keyed lowercase.
function sectionMap(md: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let current: string | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const h = raw.match(/^#{1,6}\s+(.*)$/);
    if (h) { current = h[1].trim().toLowerCase(); map.set(current, []); continue; }
    if (current) map.get(current)!.push(raw);
  }
  return map;
}

function findSection(map: Map<string, string[]>, ...keywords: string[]): string[] | undefined {
  for (const [title, lines] of map) {
    if (keywords.some((k) => title.includes(k))) return lines;
  }
  return undefined;
}

// Read a "- Label: value" bullet. `[^:]*` after the label tolerates parentheticals
// like "Hyperframes prompt (if generative): …".
function bullet(lines: string[] | undefined, label: string): string | undefined {
  if (!lines) return undefined;
  const re = new RegExp(`^[-*]\\s*${label}[^:]*:\\s*(.+)$`, 'i');
  for (const l of lines) {
    const m = l.match(re);
    if (m) { const v = clean(m[1]); if (v && v !== '—') return v; }
  }
  return undefined;
}

function parseTable(lines: string[] | undefined): StoryboardScene[] {
  if (!lines) return [];
  const out: StoryboardScene[] = [];
  for (const row of lines) {
    if (!row.trim().startsWith('|')) continue;
    const cells = row.split('|').map((c) => c.trim());
    // Drop the empty cells the leading/trailing pipes produce.
    if (cells.length && cells[0] === '') cells.shift();
    if (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.length < 2) continue;
    const joined = cells.join(' ').toLowerCase();
    if (joined.includes('---')) continue;                                  // separator row
    if (cells[0].toLowerCase().startsWith('time') && joined.includes('visual')) continue; // header row
    // Optional 5th "Clip" column references a real Media-library asset. Tolerate
    // an empty cell / em-dash placeholder (no clip → undefined, behaves as before).
    const clipCell = cells[4] && cells[4] !== '—' ? clean(cells[4]) : '';
    out.push({
      time: clean(cells[0] ?? ''),
      visual: clean(cells[1] ?? ''),
      onScreenText: cells[2] && cells[2] !== '—' ? clean(cells[2]) : '',
      audio: clean(cells[3] ?? ''),
      ...(clipCell ? { clip: clipCell } : {}),
    });
  }
  return out;
}

export function parseStoryboard(md: string): Storyboard {
  const map = sectionMap(md || '');
  const pl = findSection(map, 'platform', 'length');
  const hookLines = findSection(map, 'hook');
  const sceneLines = findSection(map, 'scene');
  const ctaLines = findSection(map, 'cta', 'call to action');
  const prodLines = findSection(map, 'production');
  const riskLines = findSection(map, 'risk', 'claim');

  const scenes = parseTable(sceneLines);
  const hook = hookLines
    ? { onScreenText: bullet(hookLines, 'on-screen text'), visual: bullet(hookLines, 'visual'), audio: bullet(hookLines, 'audio'), clip: bullet(hookLines, 'clip') }
    : undefined;

  const sb: Storyboard = {
    platform: bullet(pl, 'platform'),
    length: bullet(pl, 'length'),
    aspect: bullet(pl, 'aspect'),
    hook: hook && (hook.onScreenText || hook.visual || hook.audio || hook.clip) ? hook : undefined,
    scenes,
    cta: ctaLines ? { onScreenText: bullet(ctaLines, 'on-screen text'), visual: bullet(ctaLines, 'visual'), clip: bullet(ctaLines, 'clip') } : undefined,
    production: prodLines
      ? {
          music: bullet(prodLines, 'music'),
          pacing: bullet(prodLines, 'pacing'),
          broll: bullet(prodLines, 'b-roll'),
          hyperframesPrompt: bullet(prodLines, 'hyperframes prompt'),
        }
      : undefined,
    risks: riskLines
      ? riskLines.filter((l) => /^[-*]\s+/.test(l.trim())).map((l) => clean(l.replace(/^[-*]\s+/, ''))).filter((l) => l && l.toLowerCase() !== 'none')
      : undefined,
    parsed: false,
  };
  sb.parsed = Boolean(sb.hook || scenes.length > 0 || sb.platform);
  return sb;
}
