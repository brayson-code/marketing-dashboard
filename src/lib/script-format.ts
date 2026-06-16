// Shared formatting for reel/video scripts → a clean, readable teleprompter
// script. Generated scripts arrive in a few shapes:
//   (a) a clean "SPOKEN SCRIPT" block (HOOK / BODY / CTA) — our newer format,
//   (b) a Hyperframes storyboard: a "## Hook" section + a Scenes table (Time |
//       Visual | On-screen text | Audio | Clip) + a "## CTA" section,
//   (c) a plain labeled script ("Hook: …", "CTA: …").
// We want EVERY spoken beat — the hook, every scene's line, the CTA — in order,
// in plain English, with the beat/scene label called out (rendered green in the
// teleprompter) and NO markdown / table pipes / visual+timing scaffolding.

export const SECTION_LABELS = [
  'HOOK', 'HOOK LINE', 'COLD OPEN', 'OPEN', 'OPENING', 'INTRO',
  'SETUP', 'PROBLEM', 'PAIN', 'AGITATE', 'SOLUTION', 'BODY', 'MIDDLE',
  'VALUE', 'POINT', 'BEAT', 'STORY', 'PROOF', 'EXAMPLE', 'TURN', 'TWIST',
  'PAYOFF', 'CTA', 'CALL TO ACTION', 'OUTRO', 'CLOSE', 'CLOSING', 'END', 'SCENE',
];
const LABEL_SET = new Set(SECTION_LABELS);

export interface ScriptBlock { label: string | null; body: string }

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
    .trim();
}

const dequote = (s: string) => s.replace(/^["'“”]+|["'“”]+$/g, '').trim();

// Strip the machine-readable hint tags ([broll: …], [stat: …]) the agent embeds.
const stripHints = (s: string) => s.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();

const RULE_LINE = /^\s*([-=*_|:\s])+$/;
const TIMING_ONLY = /^\s*\(?\d{1,2}:\d{2}(\.\d)?\s*[–-]\s*\d{1,2}:\d{2}(\.\d)?\)?\s*$/;
// Bullet/field keys that are production scaffolding, never read aloud.
const SCAFFOLD_KEY = /^(on[- ]?screen text|on[- ]?screen|visual|visuals|clip|time|timing|b-?roll|shot|note|notes|platform|length|aspect|caption|infographic|stat)$/i;
// Field keys whose VALUE is the spoken line.
const SPOKEN_KEY = /^(audio|voiceover|vo|narration|spoken|spoken line|line|say|script)$/i;

function splitCells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function normalizeLabel(s: string): string {
  return s.trim().toUpperCase().replace(/\s*\(.*\)\s*$/, '').replace(/[:.]+$/, '').replace(/\s+/g, ' ').trim();
}

// ── Path A: clean "SPOKEN SCRIPT" block (or a plain labeled script) ────────────
function parseSpokenBlock(raw: string): ScriptBlock[] {
  const all = raw.split('\n');
  const marker = all.findIndex((l) => /^\s*#{0,6}\s*spoken script\s*:?\s*$/i.test(l.trim()));
  const start = marker >= 0 ? marker + 1 : 0;
  const blocks: ScriptBlock[] = [];
  let cur: ScriptBlock | null = null;
  for (let i = start; i < all.length; i++) {
    const line = all[i];
    // Stop if the storyboard begins after the spoken block.
    if (/^\s*\|/.test(line) || /^\s*#{1,6}\s*(scenes?|storyboard|platform)\b/i.test(line)) break;
    if (RULE_LINE.test(line) || TIMING_ONLY.test(line)) continue;
    const clean = stripHints(stripMarkdown(line));
    if (!clean) continue;
    const lab = normalizeLabel(clean);
    if (LABEL_SET.has(lab) || /^(HOOK|CTA|BODY|OUTRO)\b/.test(lab)) {
      if (cur) blocks.push(cur);
      cur = { label: lab, body: '' };
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + clean;
    } else {
      cur = { label: null, body: clean };
    }
  }
  if (cur) blocks.push(cur);
  return blocks.map((b) => ({ label: b.label, body: b.body.trim() })).filter((b) => b.label || b.body);
}

// ── Path B: Hyperframes storyboard → extract every spoken beat in order ────────
function parseStoryboard(raw: string): ScriptBlock[] {
  const lines = raw.split('\n');
  // Find the Audio/spoken column index from the table header, if there is one.
  let audioCol = -1;
  for (const l of lines) {
    if (/^\s*\|/.test(l) && /audio|spoken|voiceover|\bvo\b|narration|script|say/i.test(l)) {
      audioCol = splitCells(l).findIndex((c) => /audio|spoken|voiceover|\bvo\b|narration|script|say/i.test(c));
      break;
    }
  }

  const blocks: ScriptBlock[] = [];
  const state: { cur: ScriptBlock | null } = { cur: null };
  let sceneN = 0;
  const open = (label: string | null) => { if (state.cur && (state.cur.label || state.cur.body)) blocks.push(state.cur); state.cur = { label, body: '' }; };
  const add = (s: string) => { if (!s) return; if (!state.cur) state.cur = { label: null, body: '' }; state.cur.body += (state.cur.body ? '\n' : '') + s; };

  for (const line of lines) {
    const t = line.trim();
    if (!t || RULE_LINE.test(t) || TIMING_ONLY.test(t)) continue;

    // Headings → section labels (skip pure-scaffold sections).
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
    if (h) {
      const lab = normalizeLabel(h[1]);
      if (/^(PLATFORM|LENGTH|ASPECT|SCENES?|STORYBOARD|OUTPUT|HINTS?|MACHINE|PRODUCTION|MEDIA)/.test(lab)) { open(null); continue; }
      open(lab);
      continue;
    }

    // Table rows → pull the spoken cell.
    if (/^\s*\|/.test(line)) {
      const cells = splitCells(line);
      // Skip the header row and the |---| separator.
      if (cells.some((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (cells.some((c) => /^(time|visual|on[- ]?screen( text)?|clip|audio|spoken)$/i.test(c))) continue;
      let spoken = audioCol >= 0 ? (cells[audioCol] || '') : '';
      if (!spoken) {
        // No labeled column — take the longest sentence-like, non-hint cell.
        spoken = cells.filter((c) => c && !/^\[/.test(c) && /\s/.test(c)).sort((a, b) => b.length - a.length)[0] || '';
      }
      spoken = stripHints(dequote(stripMarkdown(spoken)));
      if (spoken) { sceneN += 1; open(`SCENE ${sceneN}`); add(spoken); }
      continue;
    }

    // Bullet/field lines ("- Audio: …", "On-screen text: …", "Hook: …").
    const f = /^-?\s*([A-Za-z][A-Za-z' \-]{1,22}?)\s*:\s*(.*)$/.exec(t);
    if (f) {
      const key = f[1].trim();
      const val = stripHints(dequote(stripMarkdown(f[2])));
      if (SPOKEN_KEY.test(key)) { add(val); continue; }
      if (SCAFFOLD_KEY.test(key)) continue;
      const lab = normalizeLabel(key);
      if (LABEL_SET.has(lab)) { open(lab); if (val) add(val); continue; }
      if (val) add(val);
      continue;
    }

    // Plain prose (skip stray hint-only lines).
    if (!/^\[/.test(t)) add(stripHints(stripMarkdown(t)));
  }
  if (state.cur && (state.cur.label || state.cur.body)) blocks.push(state.cur);
  return blocks.map((b) => ({ label: b.label, body: b.body.trim() })).filter((b) => b.label || b.body);
}

/** Parse a raw script into ordered, readable beats for the teleprompter. */
export function parseScript(raw: string): ScriptBlock[] {
  const text = (raw || '').replace(/\r\n/g, '\n');
  const hasSpokenBlock = /^\s*#{0,6}\s*spoken script\s*:?\s*$/im.test(text);
  const hasStoryboard = /\n\s*\|/.test(text) || /^\s*-?\s*(audio|voiceover|on[- ]?screen)\s*:/im.test(text) || /^#{1,6}\s+hook\b/im.test(text);
  if (hasSpokenBlock || !hasStoryboard) return parseSpokenBlock(text);
  return parseStoryboard(text);
}

/** A flat, markdown-free, preamble-free version of the script. */
export function toPlainScript(raw: string): string {
  return parseScript(raw)
    .map((b) => (b.label ? `${b.label}\n${b.body}` : b.body))
    .join('\n\n')
    .trim();
}
