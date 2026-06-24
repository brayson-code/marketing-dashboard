// Multi-format export of markdown content → md | html | docx | pdf | pptx | xlsx.
//
// Pure, dependency-light converters that take a markdown string (the content of
// a draft or a document) and return a downloadable artifact. No tenant access,
// no I/O — the calling route owns fetching + tenant scoping; this file only
// transforms text → bytes. Must run on the nodejs runtime (docx/pdf-lib/pptxgenjs
// /exceljs are not edge-safe); the routes set `export const runtime = "nodejs"`.
//
// marked parses markdown → a token stream we walk once. Each target format has a
// small renderer tuned for "a clean, readable client deliverable", not a
// pixel-perfect reproduction of a browser render.

import { marked, type Token, type Tokens } from 'marked';
import {
  Document,
  Packer,
  Paragraph as DocxParagraph,
  TextRun,
  HeadingLevel,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  AlignmentType,
} from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PptxGenJS from 'pptxgenjs';
import ExcelJS from 'exceljs';

export type ExportFormat = 'md' | 'html' | 'docx' | 'pdf' | 'pptx' | 'xlsx';

export interface ConvertResult {
  buffer: Buffer | Uint8Array;
  contentType: string;
  ext: string;
}

// Single source of truth for mime + extension per format. Routes use this to
// validate `?format=` and to build the Content-Type / filename.
export const FORMATS: Record<ExportFormat, { contentType: string; ext: string }> = {
  md: { contentType: 'text/markdown; charset=utf-8', ext: 'md' },
  html: { contentType: 'text/html; charset=utf-8', ext: 'html' },
  docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  pdf: { contentType: 'application/pdf', ext: 'pdf' },
  pptx: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
  xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
};

export function isExportFormat(v: string): v is ExportFormat {
  return v === 'md' || v === 'html' || v === 'docx' || v === 'pdf' || v === 'pptx' || v === 'xlsx';
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Flatten a token's inline children (or its raw text) to plain text. */
function inlineText(token: { text?: string; tokens?: Token[] }): string {
  if (Array.isArray(token.tokens) && token.tokens.length > 0) {
    return token.tokens.map((t) => tokenText(t)).join('');
  }
  return token.text ?? '';
}

function tokenText(t: Token): string {
  switch (t.type) {
    case 'text':
    case 'codespan':
    case 'escape':
      return (t as Tokens.Text | Tokens.Codespan | Tokens.Escape).text ?? '';
    case 'strong':
    case 'em':
    case 'del':
    case 'link':
      return inlineText(t as Tokens.Strong);
    case 'br':
      return '\n';
    case 'image':
      return (t as Tokens.Image).text ?? '';
    case 'html':
      return '';
    default:
      return (t as { text?: string }).text ?? '';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Tables present in the markdown, as plain string grids (header + rows). */
function extractTables(md: string): Array<{ header: string[]; rows: string[][] }> {
  const tokens = marked.lexer(md);
  const out: Array<{ header: string[]; rows: string[][] }> = [];
  for (const tok of tokens) {
    if (tok.type === 'table') {
      const table = tok as Tokens.Table;
      out.push({
        header: table.header.map((c) => inlineText(c).trim()),
        rows: table.rows.map((r) => r.map((c) => inlineText(c).trim())),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// md (raw)
// ---------------------------------------------------------------------------

export function toMarkdown(md: string): ConvertResult {
  return { buffer: Buffer.from(md, 'utf-8'), contentType: FORMATS.md.contentType, ext: FORMATS.md.ext };
}

// ---------------------------------------------------------------------------
// html (marked → a minimal self-contained styled doc)
// ---------------------------------------------------------------------------

export function toHtml(md: string, title = 'Document'): ConvertResult {
  const body = marked.parse(md, { async: false }) as string;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 760px; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; background: #fff; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 .5em; font-weight: 650; }
  h1 { font-size: 2rem; border-bottom: 1px solid #e5e5e5; padding-bottom: .3em; }
  h2 { font-size: 1.5rem; }
  h3 { font-size: 1.2rem; }
  p { margin: 0 0 1em; }
  a { color: #2563eb; }
  code { background: #f4f4f5; padding: .15em .35em; border-radius: 4px; font-size: .9em; }
  pre { background: #f4f4f5; padding: 1em; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: .2em 1em; border-left: 3px solid #d4d4d8; color: #52525b; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .95em; }
  th, td { border: 1px solid #e4e4e7; padding: .5em .75em; text-align: left; }
  th { background: #fafafa; font-weight: 600; }
  img { max-width: 100%; }
  ul, ol { padding-left: 1.5em; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  return { buffer: Buffer.from(html, 'utf-8'), contentType: FORMATS.html.contentType, ext: FORMATS.html.ext };
}

// ---------------------------------------------------------------------------
// docx
// ---------------------------------------------------------------------------

const DOCX_HEADINGS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

/** Build docx inline TextRuns from a token's children, honouring bold/italic. */
function docxRuns(tokens: Token[] | undefined, fallback: string): TextRun[] {
  if (!tokens || tokens.length === 0) return [new TextRun(fallback)];
  const runs: TextRun[] = [];
  const walk = (toks: Token[], bold: boolean, italics: boolean) => {
    for (const t of toks) {
      switch (t.type) {
        case 'strong':
          walk((t as Tokens.Strong).tokens ?? [], true, italics);
          break;
        case 'em':
          walk((t as Tokens.Em).tokens ?? [], bold, true);
          break;
        case 'del':
          for (const c of (t as Tokens.Del).tokens ?? []) walk([c], bold, italics);
          break;
        case 'codespan':
          runs.push(new TextRun({ text: (t as Tokens.Codespan).text, font: 'Consolas', bold, italics }));
          break;
        case 'br':
          runs.push(new TextRun({ break: 1 }));
          break;
        case 'link':
          walk((t as Tokens.Link).tokens ?? [], bold, italics);
          break;
        default: {
          const txt = (t as { text?: string }).text ?? '';
          if (txt) runs.push(new TextRun({ text: txt, bold, italics }));
        }
      }
    }
  };
  walk(tokens, false, false);
  return runs.length > 0 ? runs : [new TextRun(fallback)];
}

function docxListParagraphs(list: Tokens.List, depth = 0): DocxParagraph[] {
  const paras: DocxParagraph[] = [];
  list.items.forEach((item) => {
    const itemTokens = (item as Tokens.ListItem).tokens ?? [];
    // The first text/paragraph token is the item's own line; nested lists recurse.
    const own = itemTokens.find((t) => t.type === 'text' || t.type === 'paragraph') as
      | (Tokens.Text | Tokens.Paragraph)
      | undefined;
    paras.push(
      new DocxParagraph({
        children: docxRuns(own?.tokens, own?.text ?? item.text ?? ''),
        bullet: list.ordered ? undefined : { level: depth },
        numbering: list.ordered ? { reference: 'num-list', level: depth } : undefined,
      }),
    );
    for (const t of itemTokens) {
      if (t.type === 'list') paras.push(...docxListParagraphs(t as Tokens.List, depth + 1));
    }
  });
  return paras;
}

function docxTable(table: Tokens.Table): DocxTable {
  const headerRow = new DocxTableRow({
    tableHeader: true,
    children: table.header.map(
      (cell) =>
        new DocxTableCell({
          children: [new DocxParagraph({ children: [new TextRun({ text: inlineText(cell).trim(), bold: true })] })],
        }),
    ),
  });
  const bodyRows = table.rows.map(
    (row) =>
      new DocxTableRow({
        children: row.map(
          (cell) =>
            new DocxTableCell({
              children: [new DocxParagraph({ children: docxRuns(cell.tokens, inlineText(cell).trim()) })],
            }),
        ),
      }),
  );
  return new DocxTable({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] });
}

export async function toDocx(md: string, title = 'Document'): Promise<ConvertResult> {
  const tokens = marked.lexer(md);
  const children: Array<DocxParagraph | DocxTable> = [];

  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading': {
        const h = tok as Tokens.Heading;
        children.push(
          new DocxParagraph({
            heading: DOCX_HEADINGS[h.depth] ?? HeadingLevel.HEADING_6,
            children: docxRuns(h.tokens, h.text),
          }),
        );
        break;
      }
      case 'paragraph': {
        const p = tok as Tokens.Paragraph;
        children.push(new DocxParagraph({ children: docxRuns(p.tokens, p.text) }));
        break;
      }
      case 'list':
        children.push(...docxListParagraphs(tok as Tokens.List));
        break;
      case 'table':
        children.push(docxTable(tok as Tokens.Table));
        children.push(new DocxParagraph({ text: '' }));
        break;
      case 'blockquote': {
        const bq = tok as Tokens.Blockquote;
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: bq.text, italics: true, color: '666666' })],
            indent: { left: 360 },
          }),
        );
        break;
      }
      case 'code': {
        const code = tok as Tokens.Code;
        for (const line of code.text.split('\n')) {
          children.push(new DocxParagraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 18 })] }));
        }
        break;
      }
      case 'hr':
        children.push(new DocxParagraph({ text: '', border: { bottom: { style: 'single', size: 6, color: 'cccccc', space: 1 } } }));
        break;
      case 'space':
        break;
      default: {
        const txt = (tok as { text?: string }).text;
        if (txt && txt.trim()) children.push(new DocxParagraph({ text: txt }));
      }
    }
  }

  const doc = new Document({
    creator: 'KeyPlayers HQ',
    title,
    numbering: {
      config: [
        {
          reference: 'num-list',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: 'decimal' as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        children: [
          new DocxParagraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })] }),
          ...children,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return { buffer, contentType: FORMATS.docx.contentType, ext: FORMATS.docx.ext };
}

// ---------------------------------------------------------------------------
// pdf (pdf-lib — clean readable report, paginated)
// ---------------------------------------------------------------------------

interface PdfLine {
  text: string;
  size: number;
  bold: boolean;
  gapBefore: number;
}

/** Greedy word-wrap to a max width at a given font/size. */
function wrapText(text: string, font: import('pdf-lib').PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // A single word longer than the line — hard-break it by characters.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function toPdf(md: string, title = 'Document'): Promise<ConvertResult> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 612; // US Letter
  const PAGE_H = 792;
  const MARGIN = 56;
  const MAX_W = PAGE_W - MARGIN * 2;

  // Flatten markdown into a list of styled logical lines (before wrapping).
  const logical: PdfLine[] = [{ text: title, size: 22, bold: true, gapBefore: 0 }];
  const tokens = marked.lexer(md);
  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading': {
        const h = tok as Tokens.Heading;
        const size = Math.max(12, 20 - (h.depth - 1) * 2.5);
        logical.push({ text: inlineText(h).trim(), size, bold: true, gapBefore: 10 });
        break;
      }
      case 'paragraph': {
        logical.push({ text: inlineText(tok as Tokens.Paragraph).trim(), size: 11, bold: false, gapBefore: 6 });
        break;
      }
      case 'list': {
        const list = tok as Tokens.List;
        list.items.forEach((item, i) => {
          const marker = list.ordered ? `${(typeof list.start === 'number' ? list.start : 1) + i}.` : '•';
          logical.push({ text: `${marker}  ${(item.text ?? '').trim()}`, size: 11, bold: false, gapBefore: 3 });
        });
        break;
      }
      case 'table': {
        const table = tok as Tokens.Table;
        logical.push({ text: table.header.map((c) => inlineText(c).trim()).join('  |  '), size: 11, bold: true, gapBefore: 8 });
        for (const row of table.rows) {
          logical.push({ text: row.map((c) => inlineText(c).trim()).join('  |  '), size: 11, bold: false, gapBefore: 2 });
        }
        break;
      }
      case 'blockquote':
        logical.push({ text: (tok as Tokens.Blockquote).text.trim(), size: 11, bold: false, gapBefore: 6 });
        break;
      case 'code': {
        for (const line of (tok as Tokens.Code).text.split('\n')) {
          logical.push({ text: line, size: 10, bold: false, gapBefore: 1 });
        }
        break;
      }
      case 'hr':
        logical.push({ text: '────────────────', size: 11, bold: false, gapBefore: 6 });
        break;
      default:
        break;
    }
  }

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  for (const ln of logical) {
    const font = ln.bold ? helvBold : helv;
    y -= ln.gapBefore;
    const wrapped = wrapText(ln.text, font, ln.size, MAX_W);
    const lineHeight = ln.size * 1.35;
    for (const w of wrapped) {
      if (y - lineHeight < MARGIN) newPage();
      page.drawText(w, { x: MARGIN, y: y - ln.size, size: ln.size, font, color: rgb(0.1, 0.1, 0.12) });
      y -= lineHeight;
    }
  }

  const bytes = await pdf.save();
  return { buffer: bytes, contentType: FORMATS.pdf.contentType, ext: FORMATS.pdf.ext };
}

// ---------------------------------------------------------------------------
// pptx (split into slides at each H1/H2; title slide + one per section)
// ---------------------------------------------------------------------------

interface Section {
  heading: string;
  bullets: string[];
}

function sectionsFromMarkdown(md: string): Section[] {
  const tokens = marked.lexer(md);
  const sections: Section[] = [];
  let current: Section | null = null;

  const pushBullet = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (!current) current = { heading: '', bullets: [] };
    current.bullets.push(t);
  };

  for (const tok of tokens) {
    if (tok.type === 'heading') {
      const h = tok as Tokens.Heading;
      if (h.depth <= 2) {
        if (current) sections.push(current);
        current = { heading: inlineText(h).trim(), bullets: [] };
      } else {
        // h3+ becomes an emphasized bullet line within the current section.
        pushBullet(inlineText(h).trim());
      }
    } else if (tok.type === 'paragraph') {
      pushBullet(inlineText(tok as Tokens.Paragraph));
    } else if (tok.type === 'list') {
      for (const item of (tok as Tokens.List).items) pushBullet(item.text ?? '');
    } else if (tok.type === 'blockquote') {
      pushBullet((tok as Tokens.Blockquote).text);
    } else if (tok.type === 'code') {
      for (const line of (tok as Tokens.Code).text.split('\n')) pushBullet(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

export async function toPptx(md: string, title = 'Presentation'): Promise<ConvertResult> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.author = 'KeyPlayers HQ';
  pptx.title = title;

  const NAVY = '1E293B';
  const ACCENT = '2563EB';
  const GREY = '475569';

  // Title slide
  const title0 = pptx.addSlide();
  title0.background = { color: 'F8FAFC' };
  title0.addText(title, {
    x: 0.8,
    y: 2.6,
    w: 11.7,
    h: 1.6,
    fontSize: 40,
    bold: true,
    color: NAVY,
    align: 'left',
  });
  title0.addText('KeyPlayers HQ', { x: 0.8, y: 4.3, w: 11.7, h: 0.5, fontSize: 16, color: ACCENT });

  const sections = sectionsFromMarkdown(md);
  for (const section of sections) {
    const slide = pptx.addSlide();
    slide.addText(section.heading || title, {
      x: 0.7,
      y: 0.5,
      w: 11.9,
      h: 0.9,
      fontSize: 28,
      bold: true,
      color: NAVY,
    });
    if (section.bullets.length > 0) {
      slide.addText(
        section.bullets.slice(0, 14).map((b) => ({ text: b, options: { bullet: true, color: GREY } })),
        { x: 0.9, y: 1.7, w: 11.5, h: 5.2, fontSize: 16, valign: 'top', lineSpacingMultiple: 1.15 },
      );
    }
  }

  // pptxgenjs returns a Promise of the requested output type; nodebuffer → Buffer.
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return { buffer, contentType: FORMATS.pptx.contentType, ext: FORMATS.pptx.ext };
}

// ---------------------------------------------------------------------------
// xlsx (tables → sheets; or text → a Content sheet)
// ---------------------------------------------------------------------------

function sheetSafeName(name: string, index: number): string {
  // Excel sheet names: ≤31 chars, no : \ / ? * [ ]
  const cleaned = (name || `Sheet${index + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

export async function toXlsx(md: string, title = 'Document'): Promise<ConvertResult> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KeyPlayers HQ';
  wb.title = title;

  const tables = extractTables(md);

  if (tables.length > 0) {
    tables.forEach((table, i) => {
      const ws = wb.addWorksheet(sheetSafeName(tables.length === 1 ? title || 'Table' : `Table ${i + 1}`, i));
      const header = ws.addRow(table.header);
      header.font = { bold: true };
      header.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
      });
      for (const row of table.rows) ws.addRow(row);
      // Auto-ish width from the longest cell per column.
      ws.columns.forEach((col, c) => {
        const cells = [table.header[c], ...table.rows.map((r) => r[c])].filter(Boolean);
        const max = cells.reduce((m, v) => Math.max(m, String(v ?? '').length), 8);
        col.width = Math.min(60, max + 2);
      });
    });
  } else {
    // No GFM table — dump the text content, one logical line per row.
    const ws = wb.addWorksheet('Content');
    const titleRow = ws.addRow([title]);
    titleRow.font = { bold: true, size: 14 };
    ws.addRow([]);
    const tokens = marked.lexer(md);
    for (const tok of tokens) {
      if (tok.type === 'heading') {
        const r = ws.addRow([inlineText(tok as Tokens.Heading).trim()]);
        r.font = { bold: true };
      } else if (tok.type === 'paragraph') {
        ws.addRow([inlineText(tok as Tokens.Paragraph).trim()]);
      } else if (tok.type === 'list') {
        for (const item of (tok as Tokens.List).items) ws.addRow([`• ${(item.text ?? '').trim()}`]);
      } else if (tok.type === 'blockquote') {
        ws.addRow([(tok as Tokens.Blockquote).text.trim()]);
      } else if (tok.type === 'code') {
        for (const line of (tok as Tokens.Code).text.split('\n')) ws.addRow([line]);
      } else if (tok.type === 'space') {
        ws.addRow([]);
      }
    }
    ws.getColumn(1).width = 100;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), contentType: FORMATS.xlsx.contentType, ext: FORMATS.xlsx.ext };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function convert(format: ExportFormat, md: string, title = 'Document'): Promise<ConvertResult> {
  const content = md ?? '';
  switch (format) {
    case 'md':
      return toMarkdown(content);
    case 'html':
      return toHtml(content, title);
    case 'docx':
      return toDocx(content, title);
    case 'pdf':
      return toPdf(content, title);
    case 'pptx':
      return toPptx(content, title);
    case 'xlsx':
      return toXlsx(content, title);
    default:
      throw new Error(`Unsupported export format: ${format as string}`);
  }
}
