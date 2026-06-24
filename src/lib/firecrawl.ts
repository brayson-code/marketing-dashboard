// Firecrawl — "brand scraping" for any public website (a competitor's site, a
// prospect's homepage, the tenant's own marketing page). Pulls clean markdown
// plus a structured BRAND identity (name, tagline, palette, fonts, logo, socials)
// in ONE scrape so agents can ground brand work in the real source rather than
// guessing.
//
// BYO key: each tenant pastes their Firecrawl key in Connections (stored AES-256
// encrypted, scoped to tenant_id — see integrations-store.ts). Falls back to
// FIRECRAWL_API_KEY (env) for the owner/HQ tenant + local testing. Mirrors the
// key pattern in apify.ts getApifyKey().
//
// Firecrawl's response fields are best-effort (the model may not surface every
// brand attribute for every site), so every field is read defensively — a
// missing field yields a null/empty value, never a throw.

import Firecrawl, { type Document, type BrandingProfile } from '@mendable/firecrawl-js';
import { getDecryptedSecret } from './integrations-store';

/** Markdown is capped so a huge page can't blow up a tool_result / prompt. */
const MARKDOWN_CAP = 12_000;

/** Normalized brand profile consumed by the rest of the app. Free-text fields
 *  default to '' and lists to [] so callers never have to null-check; logoUrl is
 *  null (not '') when absent so "no logo" is distinguishable from "". */
export interface BrandProfile {
  url: string;
  title: string;
  description: string;
  markdown: string; // trimmed + capped to ~12k chars
  colors: string[];
  fonts: string[];
  logoUrl: string | null;
  name: string;
  tagline: string;
  socials: string[];
}

/** The Firecrawl key for the CURRENT tenant: their pasted key first, then the env
 *  fallback (owner/HQ + local testing). Null when neither is set. Relies on the
 *  caller having entered tenant context (enterTenant). */
export async function getFirecrawlKey(): Promise<string | null> {
  try {
    const secret = await getDecryptedSecret('firecrawl');
    const tenantKey = secret?.api_key?.trim();
    if (tenantKey) return tenantKey;
  } catch {
    /* fall through to env */
  }
  const envKey = process.env.FIRECRAWL_API_KEY?.trim();
  return envKey || null;
}

// The JSON shape we ask Firecrawl to extract from the page. Everything is
// optional — the model fills what it can find and omits the rest.
interface BrandJson {
  name?: unknown;
  tagline?: unknown;
  description?: unknown;
  colors?: unknown;
  logoUrl?: unknown;
  socials?: unknown;
}

const BRAND_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The brand / company name.' },
    tagline: { type: 'string', description: 'The brand tagline or one-line value prop.' },
    description: { type: 'string', description: 'A short description of what the brand does.' },
    colors: {
      type: 'array',
      items: { type: 'string' },
      description: 'Primary brand colors as hex codes (e.g. "#1a73e8").',
    },
    logoUrl: { type: 'string', description: 'Absolute URL of the brand logo image.' },
    socials: {
      type: 'array',
      items: { type: 'string' },
      description: 'Social profile URLs (Instagram, X, LinkedIn, TikTok, etc.).',
    },
  },
};

// ── Defensive readers ─────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Coerce to a trimmed non-empty string, else null. */
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

/** Read an array of strings from an unknown value (JSON field). Filters blanks
 *  and de-dupes; never throws on a non-array. */
function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Pull hex/CSS color strings out of a BrandingProfile.colors object. Values are
 *  string|undefined; we keep the defined, non-empty ones in declaration order. */
function colorsFromBranding(branding: BrandingProfile | undefined): string[] {
  const colors = branding?.colors;
  if (!colors || typeof colors !== 'object') return [];
  const out: string[] = [];
  for (const v of Object.values(colors)) {
    const s = str(v);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Pull font family names out of a BrandingProfile.fonts array. Each entry is
 *  { family: string, ... }; we keep the distinct, non-empty families. */
function fontsFromBranding(branding: BrandingProfile | undefined): string[] {
  const fonts = branding?.fonts;
  if (!Array.isArray(fonts)) return [];
  const out: string[] = [];
  for (const f of fonts) {
    const s = str((f as { family?: unknown })?.family);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Merge two string lists, de-duped, preserving order (a first). */
function mergeUnique(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const x of b) if (x && !out.includes(x)) out.push(x);
  return out;
}

/** Map a raw Firecrawl Document into a normalized BrandProfile. Never throws on a
 *  missing field — branding/json fields are all best-effort. */
function mapDocument(url: string, doc: Document): BrandProfile {
  const meta = doc.metadata ?? {};
  const branding = doc.branding;
  const json = (doc.json ?? {}) as BrandJson;

  // Colors / fonts: prefer the structured branding profile, then fold in anything
  // the JSON extraction surfaced (some sites only expose colors in the JSON pass).
  const colors = mergeUnique(colorsFromBranding(branding), strArray(json.colors));
  const fonts = fontsFromBranding(branding);

  // Logo: JSON extraction first (it can resolve absolute URLs), then branding.logo.
  const logoUrl = strOrNull(json.logoUrl) ?? strOrNull(branding?.logo);

  const markdown = str(doc.markdown).slice(0, MARKDOWN_CAP);

  return {
    url: strOrNull(meta.url) ?? strOrNull(meta.sourceURL) ?? url,
    title: str(meta.title) || str(meta.ogTitle),
    description: str(meta.description) || str(meta.ogDescription) || str(json.description),
    markdown,
    colors,
    fonts,
    logoUrl,
    name: str(json.name) || str(meta.ogSiteName) || str(meta.title),
    tagline: str(json.tagline),
    socials: strArray(json.socials),
  };
}

/** Scrape a single URL and return a normalized BrandProfile. Throws
 *  Error('connect_firecrawl') when no key is configured for the tenant; on any
 *  scrape/parse failure the underlying error is re-thrown for the caller to map. */
export async function scrapeBrand(url: string): Promise<BrandProfile> {
  const target = url.trim();
  if (!target) throw new Error('firecrawl: a url is required');

  const key = await getFirecrawlKey();
  if (!key) throw new Error('connect_firecrawl');

  const client = new Firecrawl({ apiKey: key });
  try {
    const doc = await client.scrape(target, {
      formats: [
        'markdown',
        'branding',
        {
          type: 'json',
          prompt:
            'Extract the brand identity from this page: the brand/company name, ' +
            'tagline, a short description, primary brand colors (hex), the logo image ' +
            'URL, and any social profile links.',
          schema: BRAND_JSON_SCHEMA,
        },
      ],
      onlyMainContent: true,
    });
    return mapDocument(target, doc as Document);
  } catch (err) {
    // Surface a clean, key-free error message. Never include the key.
    throw new Error(`firecrawl: scrape failed for ${target} — ${(err as Error).message}`);
  }
}

/** Remaining Firecrawl credits for the CURRENT tenant's key, plus the plan total
 *  when the API surfaces it. Returns null when there's no key. Never throws — any
 *  fetch/parse miss yields nulls so a usage panel can render partial data. */
export async function getFirecrawlUsage(): Promise<
  { remainingCredits: number | null; planCredits: number | null } | null
> {
  const key = await getFirecrawlKey();
  if (!key) return null;
  try {
    const client = new Firecrawl({ apiKey: key });
    const usage = await client.getCreditUsage();
    const remaining = typeof usage?.remainingCredits === 'number' ? usage.remainingCredits : null;
    const plan = typeof usage?.planCredits === 'number' ? usage.planCredits : null;
    return { remainingCredits: remaining, planCredits: plan };
  } catch {
    return { remainingCredits: null, planCredits: null };
  }
}
