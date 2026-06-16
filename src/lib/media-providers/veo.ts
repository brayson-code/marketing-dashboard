// Veo — Google's image→video model via the Gemini API. Long-running: submit returns
// an operation name; poll until done, then the completed op carries a video URI that
// must be fetched WITH the API key.

import type { MediaProvider, GenInput, SubmitResult, PollResult } from './types';
import { getGoogleAiKey, fetchAsBase64 } from './types';

const MODEL = 'veo-3.1-generate-preview';
const START = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predictLongRunning`;
const OP_BASE = 'https://generativelanguage.googleapis.com/v1beta/';

export const veo: MediaProvider = {
  id: 'veo',
  label: 'Veo (Google image→video)',
  kind: 'image-to-video',
  getKey: getGoogleAiKey,

  async submit(input: GenInput): Promise<SubmitResult> {
    const key = await getGoogleAiKey();
    if (!key) return { kind: 'error', error: 'Connect Google AI (Gemini) on the Connections page first.' };

    const instance: { prompt: string; image?: { inlineData: { mimeType: string; data: string } } } = {
      prompt: input.prompt?.trim() || 'Animate this image with subtle, natural motion.',
    };
    if (input.imageUrl) {
      const img = await fetchAsBase64(input.imageUrl);
      if (img) instance.image = { inlineData: { mimeType: img.mime, data: img.base64 } };
    }

    let res: Response;
    try {
      res = await fetch(START, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: input.aspect || '9:16', resolution: '720p' } }),
      });
    } catch (e) {
      return { kind: 'error', error: `Veo unreachable — ${(e as Error).message}` };
    }

    const json = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
    if (!res.ok) return { kind: 'error', error: json?.error?.message || `Veo error (HTTP ${res.status})` };
    if (!json?.name) return { kind: 'error', error: 'Veo returned no operation id.' };
    return { kind: 'async', externalId: json.name };
  },

  async poll(externalId: string): Promise<PollResult> {
    const key = await getGoogleAiKey();
    if (!key) return { status: 'failed', error: 'No Google AI key configured.' };

    let res: Response;
    try {
      res = await fetch(`${OP_BASE}${externalId}`, { headers: { 'x-goog-api-key': key } });
    } catch {
      return { status: 'processing' }; // transient network — keep polling
    }
    const json = (await res.json().catch(() => ({}))) as {
      done?: boolean;
      error?: { message?: string };
      response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
    };
    if (json?.error) return { status: 'failed', error: json.error.message || 'Veo operation failed.' };
    if (!json?.done) return { status: 'processing' };
    const uri = json?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) return { status: 'failed', error: 'Veo completed but returned no video.' };
    return { status: 'completed', fetch: { url: uri, headers: { 'x-goog-api-key': key } } };
  },
};
