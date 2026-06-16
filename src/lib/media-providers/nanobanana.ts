// Nano Banana Pro — Google's Gemini 3 Pro Image model (text→image, image+text→image).
// Synchronous: generateContent returns the image bytes inline (base64 PNG).

import type { MediaProvider, GenInput, SubmitResult } from './types';
import { getGoogleAiKey, fetchAsBase64 } from './types';

const MODEL = 'gemini-3-pro-image'; // Nano Banana Pro
const ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`;

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type?: string; data?: string };
  inlineData?: { mimeType?: string; data?: string };
}

export const nanobanana: MediaProvider = {
  id: 'nanobanana',
  label: 'Nano Banana Pro (Gemini image)',
  kind: 'text-to-image',
  getKey: getGoogleAiKey,

  async submit(input: GenInput): Promise<SubmitResult> {
    const key = await getGoogleAiKey();
    if (!key) return { kind: 'error', error: 'Connect Google AI (Gemini) on the Connections page first.' };

    const parts: GeminiPart[] = [];
    if (input.prompt?.trim()) parts.push({ text: input.prompt.trim() });
    if (input.imageUrl) {
      const img = await fetchAsBase64(input.imageUrl);
      if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
    }
    if (parts.length === 0) return { kind: 'error', error: 'Add a prompt (or connect an image).' };

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            responseFormat: { image: { aspectRatio: input.aspect || '9:16' } },
          },
        }),
      });
    } catch (e) {
      return { kind: 'error', error: `Gemini unreachable — ${(e as Error).message}` };
    }

    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    };
    if (!res.ok) return { kind: 'error', error: json?.error?.message || `Gemini error (HTTP ${res.status})` };

    const out = json?.candidates?.[0]?.content?.parts ?? [];
    const imgPart = out.find((p) => p?.inline_data?.data || p?.inlineData?.data);
    const data = imgPart?.inline_data?.data || imgPart?.inlineData?.data;
    const mime = imgPart?.inline_data?.mime_type || imgPart?.inlineData?.mimeType || 'image/png';
    if (!data) return { kind: 'error', error: 'Gemini returned no image — try a different prompt.' };
    return { kind: 'image', base64: data, mime };
  },
};
