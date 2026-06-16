// Shared formatting for reel/video scripts. Generated scripts can arrive with
// markdown emphasis (**bold**), heading/quote markers, and a chatty preamble
// ("Sure! Here's a 30-second script:"). For recording we want clean, plain
// English with the structural beats (HOOK, BODY, CTA…) called out — nothing else.
//
// parseScript() → ordered blocks for rich rendering (label highlighted green in
// the teleprompter). toPlainScript() → a flat, markdown-free string.

// Beat labels we recognize at the start of a line ("Hook:", "CTA -", "**Hook**").
export const SECTION_LABELS = [
  'HOOK', 'HOOK LINE', 'COLD OPEN', 'OPEN', 'OPENING', 'INTRO',
  'SETUP', 'PROBLEM', 'PAIN', 'AGITATE', 'SOLUTION', 'BODY', 'MIDDLE',
  'VALUE', 'POINT', 'BEAT', 'STORY', 'PROOF', 'EXAMPLE', 'TURN', 'TWIST',
  'PAYOFF', 'CTA', 'CALL TO ACTION', 'OUTRO', 'CLOSE', 'CLOSING', 'END',
  'CAPTION', 'ON SCREEN', 'ON-SCREEN', 'TEXT ON SCREEN', 'B-ROLL', 'BROLL',
  'VISUAL', 'VISUALS', 'VOICEOVER', 'VO', 'SCENE',
];
const LABEL_SET = new Set(SECTION_LABELS);

export interface ScriptBlock { label: string | null; body: string }

// Strip inline markdown to plain text (emphasis, code, links, leading #/>/bullets).
function stripMarkdown(line: string): string {
  return line
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .trimEnd();
}

// Pull a leading beat label off a line: "Hook: foo" / "HOOK — foo" / "**CTA**".
function splitLabel(line: string): { label: string | null; rest: string } {
  const m = /^\s*([A-Za-z][A-Za-z' \-]{1,22}?)\s*[:—–-]\s*(.*)$/.exec(line);
  if (m) {
    const label = m[1].trim().toUpperCase().replace(/\s+/g, ' ');
    if (LABEL_SET.has(label)) return { label, rest: m[2].trim() };
  }
  // A line that is ONLY a label (e.g. a markdown heading "## Hook").
  const bare = line.trim().toUpperCase().replace(/[:.\s]+$/, '').replace(/\s+/g, ' ');
  if (LABEL_SET.has(bare)) return { label: bare, rest: '' };
  return { label: null, rest: line.trim() };
}

// Lines that are storyboard/editor scaffolding, not words to read aloud.
const STORYBOARD_HEADING = /^\s*#{0,6}\s*(storyboard|scene table|shot ?list|scenes|shooting script|production notes)\b/i;
const TABLE_LINE = /^\s*\|/;
const RULE_LINE = /^\s*([-=*_])\1{2,}\s*$/;
const TIMING_ONLY = /^\s*\(?\d{1,2}:\d{2}(\.\d)?\s*[–-]\s*\d{1,2}:\d{2}(\.\d)?\)?\s*$/;

/** Reduce a raw script to just the spoken portion: prefer an explicit
 *  "SPOKEN SCRIPT" block, otherwise everything up to the storyboard, with table
 *  rows / horizontal rules / timing-only lines stripped out. */
function spokenLines(raw: string): string[] {
  const all = (raw || '').replace(/\r\n/g, '\n').split('\n');
  const marker = all.findIndex((l) => /^\s*#{0,6}\s*spoken script\s*:?\s*$/i.test(l.trim()));
  const start = marker >= 0 ? marker + 1 : 0;
  const out: string[] = [];
  for (let i = start; i < all.length; i++) {
    const line = all[i];
    if (STORYBOARD_HEADING.test(line) || TABLE_LINE.test(line)) break; // storyboard begins → stop
    if (RULE_LINE.test(line) || TIMING_ONLY.test(line)) continue;
    out.push(stripMarkdown(line));
  }
  return out;
}

/** Parse a raw script into ordered blocks. When beat labels exist, everything
 *  before the first label (chatty preamble) is dropped; storyboard scaffolding
 *  (tables, timing rows, scene headings) is removed. */
export function parseScript(raw: string): ScriptBlock[] {
  const lines = spokenLines(raw);
  const parsed = lines.map((l) => splitLabel(l));
  const firstLabel = parsed.findIndex((p) => p.label);

  const blocks: ScriptBlock[] = [];
  const start = firstLabel >= 0 ? firstLabel : 0;
  let cur: ScriptBlock | null = null;
  for (let i = start; i < parsed.length; i++) {
    const { label, rest } = parsed[i];
    if (label) {
      if (cur) blocks.push(cur);
      cur = { label, body: rest };
    } else if (cur) {
      cur.body += (cur.body && rest ? '\n' : '') + rest;
    } else {
      // No labels at all in the script — accumulate as one unlabeled block.
      cur = { label: null, body: rest };
    }
  }
  if (cur) blocks.push(cur);
  // Trim trailing blank-body blocks and normalize internal whitespace.
  return blocks
    .map((b) => ({ label: b.label, body: b.body.replace(/\n{3,}/g, '\n\n').trim() }))
    .filter((b) => b.label || b.body);
}

/** A flat, markdown-free, preamble-free version of the script. */
export function toPlainScript(raw: string): string {
  return parseScript(raw)
    .map((b) => (b.label ? `${b.label}\n${b.body}` : b.body))
    .join('\n\n')
    .trim();
}
