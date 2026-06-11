// Deepgram — speech-to-text for reel/video audio. We hand it a remote video URL
// (e.g. the videoUrl scraped via apify.ts) and Deepgram fetches + transcribes it
// server-side, returning the plain transcript text.
//
// BYO key: each tenant pastes their Deepgram API key in Connections (stored
// AES-256 encrypted, scoped to tenant_id — see integrations-store.ts). Falls
// back to DEEPGRAM_API_KEY (env) for the owner/HQ tenant + local testing.
// Mirrors the key pattern in agentmail.ts getAgentMailKey().
//
// REST API: https://api.deepgram.com/v1/listen. Auth header `Token <key>`. For a
// remote file we POST { url } as JSON; the transcript lives at
// results.channels[0].alternatives[0].transcript.

import { getDecryptedSecret } from './integrations-store';

const LISTEN_URL = 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true';

/** The Deepgram API key for the CURRENT tenant: their pasted key first, then the
 *  env fallback (owner/HQ + local testing). Null when neither is set. Relies on
 *  the caller having entered tenant context (enterTenant). */
export async function getDeepgramKey(): Promise<string | null> {
  try {
    const secret = await getDecryptedSecret('deepgram');
    const tenantKey = secret?.api_key?.trim();
    if (tenantKey) return tenantKey;
  } catch {
    /* fall through to env */
  }
  const envKey = process.env.DEEPGRAM_API_KEY?.trim();
  return envKey || null;
}

interface DgResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string }>;
    }>;
  };
}

/** Transcribe a remote video/audio URL. Returns the plain transcript text
 *  (possibly empty if there's no detectable speech). Throws on a missing key or
 *  a non-2xx response. */
export async function transcribeUrl(videoUrl: string): Promise<string> {
  const key = await getDeepgramKey();
  if (!key) throw new Error('deepgram: no API key for this tenant');

  const res = await fetch(LISTEN_URL, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: videoUrl }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`deepgram ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as DgResponse;
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return typeof transcript === 'string' ? transcript : '';
}

const API_BASE = 'https://api.deepgram.com/v1';

interface DgProjects {
  projects?: Array<{ project_id?: string }>;
}
interface DgBalances {
  balances?: Array<{ amount?: number | string }>;
}

/** Remaining Deepgram credit (USD) for the CURRENT tenant: the sum of the first
 *  project's balances. Returns null when there's no key. usedUsd is left null
 *  (Deepgram's balances endpoint reports remaining credit, not spend). Never
 *  throws — any fetch/parse miss yields nulls. */
export async function getDeepgramUsage(): Promise<{ balanceUsd: number | null; usedUsd: number | null } | null> {
  const key = await getDeepgramKey();
  if (!key) return null;

  let balanceUsd: number | null = null;

  try {
    const projRes = await fetch(`${API_BASE}/projects`, {
      headers: { Authorization: `Token ${key}` },
    });
    if (projRes.ok) {
      const projData = (await projRes.json().catch(() => ({}))) as DgProjects;
      const projectId = projData.projects?.[0]?.project_id;
      if (projectId) {
        const balRes = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/balances`, {
          headers: { Authorization: `Token ${key}` },
        });
        if (balRes.ok) {
          const balData = (await balRes.json().catch(() => ({}))) as DgBalances;
          const balances = balData.balances ?? [];
          if (balances.length > 0) {
            let sum = 0;
            for (const b of balances) {
              const n = typeof b.amount === 'number' ? b.amount : Number(b.amount);
              if (Number.isFinite(n)) sum += n;
            }
            balanceUsd = sum;
          }
        }
      }
    }
  } catch {
    /* leave balanceUsd null */
  }

  return { balanceUsd, usedUsd: null };
}
