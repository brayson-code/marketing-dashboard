// Pluggable media-generation providers for the Hyperframes Canvas. Each provider
// is a small adapter: submit() kicks off generation (sync image OR async video op),
// poll() advances an async job. Keys follow the BYO pattern (Connections page).

import { getDecryptedSecret } from '../integrations-store';

export type MediaKind = 'text-to-image' | 'image-to-video';

export interface GenInput {
  prompt?: string;
  imageUrl?: string; // upstream image (for image→video / image→image)
  aspect?: string; // '9:16' default
}

export type SubmitResult =
  | { kind: 'image'; base64: string; mime: string } // sync, bytes ready
  | { kind: 'async'; externalId: string } // long-running op to poll
  | { kind: 'error'; error: string };

export type PollResult =
  | { status: 'processing' }
  | { status: 'completed'; fetch: { url: string; headers?: Record<string, string> } }
  | { status: 'failed'; error: string };

export interface MediaProvider {
  id: string;
  label: string;
  kind: MediaKind;
  getKey(): Promise<string | null>;
  submit(input: GenInput): Promise<SubmitResult>;
  poll?(externalId: string): Promise<PollResult>;
}

/** Google AI (Gemini) key — shared by Nano Banana (image) and Veo (video). */
export async function getGoogleAiKey(): Promise<string | null> {
  try {
    const s = (await getDecryptedSecret('google-ai')) as { api_key?: string } | null;
    const k = s?.api_key?.trim();
    if (k) return k;
  } catch {
    /* fall through to env */
  }
  return process.env.GOOGLE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
}

/** Fetch a (public Blob) URL and return base64 + mime — to feed an upstream image into a provider. */
export async function fetchAsBase64(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { base64: buf.toString('base64'), mime: r.headers.get('content-type') || 'image/png' };
  } catch {
    return null;
  }
}
