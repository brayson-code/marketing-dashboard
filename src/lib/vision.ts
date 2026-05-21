// Vision support: turns message attachments into Claude image content blocks.
//
// An Attachment is the normalized shape we store in boardroom_messages.attachments
// (a jsonb array). It comes from two sources:
//   - inbound MMS via LoopMessage (the webhook stores the media URL directly), and
//   - boardroom uploads/pastes (browser uploads to Supabase Storage, stores a
//     signed URL + storage_path).
// Either way the orchestrator downloads the URL and base64-encodes it so Claude
// "sees" the image. Base64 (not a url source) keeps us working with private
// Storage buckets and expiring/authed MMS URLs.

import Anthropic from '@anthropic-ai/sdk';

export interface Attachment {
  url: string;
  /** MIME type if known (e.g. "image/png"), else a coarse hint like "image". */
  type?: string;
  /** Supabase Storage object path, when the file lives in our bucket. */
  storage_path?: string;
  /** Original filename, for display. */
  name?: string;
}

// Claude's vision API accepts these image media types.
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

// Don't try to base64 a huge file into the prompt. 5 MB decoded is already a lot
// of tokens; anything bigger is almost certainly not a screenshot.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Cap how many images we attach to a single turn to bound token cost.
export const MAX_IMAGES_PER_MESSAGE = 4;

export function isImageAttachment(att: Attachment): boolean {
  const t = (att.type ?? '').toLowerCase();
  if (t.startsWith('image/') || t === 'image') return true;
  // Fall back to the URL/extension when the type wasn't recorded.
  const path = (att.storage_path ?? att.url ?? '').toLowerCase().split('?')[0];
  return /\.(png|jpe?g|gif|webp)$/.test(path);
}

/** Coerce a recorded type/extension into a Claude-supported media_type. */
function resolveMediaType(att: Attachment, sniffedContentType?: string | null): string | null {
  const candidates = [att.type, sniffedContentType];
  for (const c of candidates) {
    if (c && SUPPORTED_IMAGE_TYPES.has(c.toLowerCase())) return c.toLowerCase();
  }
  const path = (att.storage_path ?? att.url ?? '').toLowerCase().split('?')[0];
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.webp')) return 'image/webp';
  return null;
}

/**
 * Parse the jsonb attachments column into a typed array, tolerating null,
 * already-parsed arrays, JSON strings, and malformed entries.
 */
export function parseAttachments(raw: unknown): Attachment[] {
  if (!raw) return [];
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      url: typeof a.url === 'string' ? a.url : '',
      type: typeof a.type === 'string' ? a.type : undefined,
      storage_path: typeof a.storage_path === 'string' ? a.storage_path : undefined,
      name: typeof a.name === 'string' ? a.name : undefined,
    }))
    .filter((a) => a.url.length > 0);
}

/**
 * Download an image attachment and return a Claude image content block, or null
 * if it isn't a usable image (wrong type, too big, fetch failed). Never throws —
 * a bad attachment should degrade to text-only, not break the whole turn.
 */
export async function toImageBlock(att: Attachment): Promise<Anthropic.ImageBlockParam | null> {
  if (!isImageAttachment(att) || !att.url) return null;
  try {
    const res = await fetch(att.url);
    if (!res.ok) {
      console.error(`[vision] fetch ${res.status} for ${att.url.slice(0, 80)}`);
      return null;
    }
    const mediaType = resolveMediaType(att, res.headers.get('content-type'));
    if (!mediaType) {
      console.error(`[vision] unsupported image type for ${att.url.slice(0, 80)}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
      console.error(`[vision] image size ${buf.length} out of range`);
      return null;
    }
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType as Anthropic.Base64ImageSource['media_type'], data: buf.toString('base64') },
    };
  } catch (err) {
    console.error(`[vision] toImageBlock failed:`, (err as Error).message);
    return null;
  }
}

/**
 * Build the `content` for a user-role message from its text + attachments.
 * If there are no usable images, returns the plain text string (cheap path).
 * Otherwise returns an array of image blocks followed by a text block.
 */
export async function buildUserContent(
  text: string,
  attachments: Attachment[],
): Promise<string | Anthropic.ContentBlockParam[]> {
  const images = attachments.filter(isImageAttachment).slice(0, MAX_IMAGES_PER_MESSAGE);
  if (images.length === 0) return text;

  const blocks = await Promise.all(images.map(toImageBlock));
  const imageBlocks = blocks.filter((b): b is Anthropic.ImageBlockParam => b !== null);
  if (imageBlocks.length === 0) return text;

  const content: Anthropic.ContentBlockParam[] = [...imageBlocks];
  // Claude needs non-empty text alongside images; supply a default caption.
  content.push({ type: 'text', text: text.trim() || '(image attached — no caption)' });
  return content;
}
