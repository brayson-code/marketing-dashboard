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

// ── Path B: Hyperframes storyboard → ONLY the spoken words, grouped into the
// three beats a creator reads on a teleprompter: HOOK, BODY (every middle
// scene's line merged), CTA. No per-scene labels, no visuals/timings/on-screen
// text/hints — just the words to say. ───────────────────────────────────────────
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

  const hook: string[] = [];
  const body: string[] = [];
  const cta: string[] = [];
  // Which beat are we currently inside? Default to body (the middle).
  let beat: 'hook' | 'body' | 'cta' = 'body';
  let sawHook = false;
  const push = (s: string) => {
    const v = (s || '').trim();
    if (!v) return;
    (beat === 'hook' ? hook : beat === 'cta' ? cta : body).push(v);
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t || RULE_LINE.test(t) || TIMING_ONLY.test(t)) continue;

    // Headings just switch which beat the following spoken lines belong to.
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
    if (h) {
      const lab = normalizeLabel(h[1]);
      if (/^(HOOK|COLD OPEN|OPEN|OPENING|INTRO)\b/.test(lab)) { beat = 'hook'; sawHook = true; }
      else if (/^(CTA|CALL TO ACTION|OUTRO|CLOSE|CLOSING|END)\b/.test(lab)) { beat = 'cta'; }
      else { beat = 'body'; } // scenes / platform / everything else = the middle
      continue;
    }

    // Table rows → pull the spoken cell only (drop time/visual/on-screen/clip).
    if (/^\s*\|/.test(line)) {
      const cells = splitCells(line);
      if (cells.some((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (cells.some((c) => /^(time|visual|on[- ]?screen( text)?|clip|audio|spoken)$/i.test(c))) continue;
      let spoken = audioCol >= 0 ? (cells[audioCol] || '') : '';
      if (!spoken) spoken = cells.filter((c) => c && !/^\[/.test(c) && /\s/.test(c)).sort((a, b) => b.length - a.length)[0] || '';
      push(stripHints(dequote(stripMarkdown(spoken))));
      continue;
    }

    // Bullet/field lines: keep ONLY the spoken line; drop all scaffolding.
    const f = /^-?\s*([A-Za-z][A-Za-z' \-]{1,22}?)\s*:\s*(.*)$/.exec(t);
    if (f) {
      const key = f[1].trim();
      const val = stripHints(dequote(stripMarkdown(f[2])));
      if (SPOKEN_KEY.test(key)) { push(val); continue; }
      if (SCAFFOLD_KEY.test(key)) continue;
      const lab = normalizeLabel(key);
      if (/^(HOOK|COLD OPEN|OPEN|INTRO)\b/.test(lab)) { beat = 'hook'; sawHook = true; if (val) push(val); continue; }
      if (/^(CTA|CALL TO ACTION|OUTRO|CLOSE|END)\b/.test(lab)) { beat = 'cta'; if (val) push(val); continue; }
      if (LABEL_SET.has(lab)) { continue; } // some other label (Visual/Caption…) → ignore
      if (val) push(val);
      continue;
    }

    // Plain prose (skip stray hint-only lines).
    if (!/^\[/.test(t)) push(stripHints(stripMarkdown(t)));
  }

  // If no explicit hook heading was seen, promote the first body line to the hook.
  if (!sawHook && body.length) hook.push(body.shift() as string);

  const out: ScriptBlock[] = [];
  if (hook.length) out.push({ label: 'HOOK', body: hook.join('\n').trim() });
  if (body.length) out.push({ label: 'BODY', body: body.join('\n').trim() });
  if (cta.length) out.push({ label: 'CTA', body: cta.join('\n').trim() });
  return out.filter((b) => b.body);
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
