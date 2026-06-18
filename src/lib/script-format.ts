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

// Pull every double-quoted string ("…" or "…") of 2+ chars out of a line.
function extractQuotes(s: string): string[] {
  const out: string[] = [];
  const re = /[“"]([^”"]{2,}?)[”"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1].trim());
  return out;
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    const k = v.toLowerCase().replace(/\s+/g, ' ').trim();
    if (k && !seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out;
}

// ── Path B: Hyperframes storyboard → ONLY the spoken words, in three beats:
// HOOK / BODY / CTA. The actual spoken content lives in QUOTED strings (the
// scene captions/lines) and in the Audio field (hook + cta). EVERYTHING ELSE —
// visual direction, timings, clip ids, and the agent's unquoted "rules" prose —
// is dropped, because that's not what the creator reads aloud. ────────────────
function parseStoryboard(raw: string): ScriptBlock[] {
  const lines = raw.split('\n');
  let audioCol = -1;
  for (const l of lines) {
    if (/^\s*\|/.test(l) && /\b(audio|spoken|voiceover|vo|narration)\b/i.test(l)) {
      audioCol = splitCells(l).findIndex((c) => /\b(audio|spoken|voiceover|vo|narration)\b/i.test(c));
      break;
    }
  }

  // Per beat we collect the AUDIO line(s) and the QUOTED line(s) separately, then
  // pick: hook/cta use audio (per the brief), body uses the quotations (scenes).
  const A = { hook: [] as string[], body: [] as string[], cta: [] as string[] };
  const Q = { hook: [] as string[], body: [] as string[], cta: [] as string[] };
  let beat: 'hook' | 'body' | 'cta' = 'body';
  let sawHook = false;
  const addAudio = (s: string) => { const v = stripHints(dequote(stripMarkdown(s))).trim(); if (v) A[beat].push(v); };
  const addQuotes = (s: string) => { for (const q of extractQuotes(s)) { const v = stripHints(q).trim(); if (v) Q[beat].push(v); } };

  for (const line of lines) {
    const t = line.trim();
    if (!t || RULE_LINE.test(t) || TIMING_ONLY.test(t)) continue;

    // Headings switch the beat.
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
    if (h) {
      const lab = normalizeLabel(h[1]);
      if (/^(HOOK|COLD OPEN|OPEN|OPENING|INTRO)\b/.test(lab)) { beat = 'hook'; sawHook = true; }
      else if (/^(CTA|CALL TO ACTION|OUTRO|CLOSE|CLOSING|END)\b/.test(lab)) { beat = 'cta'; }
      else beat = 'body';
      continue;
    }

    // Table rows → the Audio cell is spoken; any quoted cell is a scene line.
    if (/^\s*\|/.test(line)) {
      const cells = splitCells(line);
      if (cells.some((c) => /^:?-{2,}:?$/.test(c))) continue;            // separator
      if (cells.some((c) => /^(time|visual|on[- ]?screen( text)?|clip|audio|spoken)$/i.test(c))) continue; // header
      if (audioCol >= 0 && cells[audioCol]) addAudio(cells[audioCol]);
      addQuotes(line);
      continue;
    }

    // Field lines: only Audio/Voiceover values count as spoken; quoted values are
    // scene lines; visuals/clips/timings/rules are dropped entirely.
    const f = /^-?\s*([A-Za-z][A-Za-z' \-]{1,22}?)\s*:\s*(.*)$/.exec(t);
    if (f) {
      const key = f[1].trim();
      const lab = normalizeLabel(key);
      if (/^(HOOK|COLD OPEN|OPEN|INTRO)\b/.test(lab)) { beat = 'hook'; sawHook = true; }
      else if (/^(CTA|CALL TO ACTION|OUTRO|CLOSE|END)\b/.test(lab)) { beat = 'cta'; }
      if (SPOKEN_KEY.test(key)) { addAudio(f[2]); continue; }
      addQuotes(f[2]); // on-screen text / caption etc. → its quoted value only
      continue;
    }

    // Plain prose: keep ONLY the quoted parts (a scene line). Unquoted prose is
    // the script's directions/rules — never read aloud, so drop it.
    addQuotes(t);
  }

  const hook = dedupe(A.hook.length ? A.hook : Q.hook);
  const body = dedupe(Q.body.length ? Q.body : A.body);
  const cta = dedupe(A.cta.length ? A.cta : Q.cta);
  if (!sawHook && body.length && !hook.length) hook.push(body.shift() as string);

  const out: ScriptBlock[] = [];
  if (hook.length) out.push({ label: 'HOOK', body: hook.join('\n').trim() });
  if (body.length) out.push({ label: 'BODY', body: body.join('\n').trim() });
  if (cta.length) out.push({ label: 'CTA', body: cta.join('\n').trim() });
  return out.filter((b) => b.body);
}

/** Parse a raw script into ordered, readable beats for the teleprompter. Strict
 *  storyboard extraction (quotes + audio only) is the default; the lenient
 *  beat-parser is the fallback for a plain labeled script with no quotes/audio. */
export function parseScript(raw: string): ScriptBlock[] {
  const text = (raw || '').replace(/\r\n/g, '\n');
  if (/^\s*#{0,6}\s*spoken script\s*:?\s*$/im.test(text)) return parseSpokenBlock(text);
  const sb = parseStoryboard(text);
  if (sb.length) return sb;
  return parseSpokenBlock(text);
}

/** A flat, markdown-free, preamble-free version of the script. */
export function toPlainScript(raw: string): string {
  return parseScript(raw)
    .map((b) => (b.label ? `${b.label}\n${b.body}` : b.body))
    .join('\n\n')
    .trim();
}
