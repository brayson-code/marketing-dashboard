// Real YouTube video upload for the current tenant's connected channel.
//
// This is the WRITE counterpart to the read/text surface in src/lib/youtube.ts.
// The Hyperframes render pipeline produces an MP4 (Vercel Blob public URL, or a
// short-lived HeyGen signed URL); the publish path hands that url here and we
// push the bytes to YouTube via the resumable upload protocol.
//
// Why not the Nango proxy (like youtube.ts): the proxy is built for JSON request/
// response calls, not a two-step resumable binary session where we read a
// `location` header from step 1 and PUT raw bytes in step 2. So instead of
// proxying, we pull the tenant's OAuth access token out of Nango and call
// googleapis.com directly with a bearer header.
//
// Scope: the youtube integration already carries
// https://www.googleapis.com/auth/youtube, which authorizes videos.insert — we do
// NOT pre-check scopes here. If a stale connection lacks it, Google answers 401/403
// and we surface that message tagged ('youtube: <Google message>'); we never fake
// a success. Read-only DB access (connection lookup only); no SQL writes.

import { getNango, providerConfigKeyFor } from './nango';
import { sql } from './db/client';
import { tenantId } from './tenant';

const PROVIDER = 'youtube';

// Resumable upload endpoint. `part` lists the resource sections we send in the
// metadata POST; Shorts classification happens server-side at YouTube for short
// vertical videos — we never append '#Shorts' ourselves.
const RESUMABLE_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 5000;

interface YTConn {
  connection_id: string;
  provider_config_key: string;
}

/** Look up this tenant's YouTube connection. Null if not connected.
 *  Mirrors the connections-table pattern in src/lib/youtube.ts. */
async function getConn(): Promise<YTConn | null> {
  const rows = (await sql()`
    SELECT connection_id, provider_config_key
    FROM connections
    WHERE tenant_id = ${tenantId()} AND provider = ${PROVIDER} AND status = 'connected'
    LIMIT 1
  `) as unknown as Array<{ connection_id: string; provider_config_key: string }>;
  const r = rows[0];
  if (!r?.connection_id) return null;
  return {
    connection_id: r.connection_id,
    provider_config_key: r.provider_config_key || providerConfigKeyFor(PROVIDER),
  };
}

/** Pull the tenant's live OAuth2 access token from Nango. Tagged-throws on any
 *  failure (Nango unconfigured, not connected, or non-OAUTH2 credentials). */
async function getAccessToken(): Promise<string> {
  const nango = getNango();
  if (!nango) throw new Error('youtube: NANGO_SECRET_KEY not configured');
  const conn = await getConn();
  if (!conn) throw new Error('youtube: not connected for this tenant');

  let creds: { credentials?: { type?: string; access_token?: string } };
  try {
    // getConnection refreshes the token if needed and returns the live
    // credentials. For an OAUTH2 grant this is { type:'OAUTH2', access_token, … }.
    creds = await nango.getConnection(conn.provider_config_key, conn.connection_id);
  } catch (e) {
    throw new Error(`youtube: could not load connection — ${(e as Error)?.message ?? 'unknown error'}`);
  }

  const c = creds?.credentials;
  if (c?.type !== 'OAUTH2' || !c.access_token) {
    throw new Error('youtube: connection has no OAuth2 access token (reconnect required)');
  }
  return c.access_token;
}

/** Best-effort extraction of Google's human-readable error message from an API
 *  response body (the resumable endpoints return { error: { message, … } }). */
async function googleErrorMessage(res: Response): Promise<string> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '';
  }
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string };
      const err = parsed?.error;
      if (typeof err === 'string' && err) return err;
      if (err && typeof err === 'object' && err.message) return err.message;
    } catch {
      // Non-JSON body — fall through to the raw text (trimmed).
    }
    return body.slice(0, 300);
  }
  return `HTTP ${res.status}`;
}

interface UploadOpts {
  videoUrl: string;
  title: string;
  description?: string;
  tags?: string[];
  privacy?: 'public' | 'unlisted' | 'private';
}

/**
 * Upload an MP4 to the connected tenant's YouTube channel via the resumable
 * protocol and return the new video's id + watch url.
 *
 * @param opts.videoUrl  Fetchable MP4 (normally a Vercel Blob public URL; may be
 *                       a HeyGen signed url). Buffered fully in memory — fine for
 *                       reels (tens of MB) on Fluid Compute.
 * @returns { video_id, url } where url = https://www.youtube.com/watch?v=<id>
 * @throws  tagged Error ('youtube: <cause>') on any failure; never fakes success.
 */
export async function uploadVideo(opts: UploadOpts): Promise<{ video_id: string; url: string }> {
  const accessToken = await getAccessToken();

  // ── 1. Initiate the resumable session with the video metadata ──────────────
  const title = (opts.title ?? '').slice(0, MAX_TITLE);
  const description = (opts.description ?? '').slice(0, MAX_DESCRIPTION);
  const tags = (opts.tags ?? []).filter((t) => typeof t === 'string' && t.trim().length > 0);

  const snippet: Record<string, unknown> = {
    title,
    description,
    categoryId: '22', // "People & Blogs" — the safe default for social/marketing reels.
  };
  if (tags.length > 0) snippet.tags = tags; // drop the key entirely when empty.

  const metadata = {
    snippet,
    status: {
      privacyStatus: opts.privacy ?? 'public',
      selfDeclaredMadeForKids: false,
    },
  };

  let initRes: Response;
  try {
    initRes = await fetch(RESUMABLE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(metadata),
    });
  } catch (e) {
    throw new Error(`youtube: could not reach upload API — ${(e as Error)?.message ?? 'network error'}`);
  }

  if (!initRes.ok) {
    // 401/403 here is typically a stale connection missing the youtube scope, or a
    // revoked grant. Surface Google's own message so the cause is actionable.
    throw new Error(`youtube: ${await googleErrorMessage(initRes)}`);
  }

  const sessionUri = initRes.headers.get('location');
  if (!sessionUri) {
    throw new Error('youtube: upload API did not return a resumable session URI');
  }

  // ── 2. Fetch the source MP4 and buffer it ──────────────────────────────────
  let srcRes: Response;
  try {
    srcRes = await fetch(opts.videoUrl);
  } catch (e) {
    throw new Error(`youtube: could not fetch source video — ${(e as Error)?.message ?? 'network error'}`);
  }
  if (!srcRes.ok) {
    throw new Error(`youtube: source video fetch failed (HTTP ${srcRes.status})`);
  }
  const bytes = Buffer.from(await srcRes.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('youtube: source video is empty');
  }

  // ── 3. PUT the bytes to the session URI (retry once on a transient 5xx) ─────
  const putBytes = async (): Promise<Response> =>
    fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(bytes.length),
      },
      body: bytes,
    });

  let uploadRes: Response;
  try {
    uploadRes = await putBytes();
    if (uploadRes.status >= 500) {
      // Resumable sessions allow re-PUTting the whole payload after a server
      // error; retry exactly once before giving up.
      uploadRes = await putBytes();
    }
  } catch (e) {
    throw new Error(`youtube: upload transfer failed — ${(e as Error)?.message ?? 'network error'}`);
  }

  if (uploadRes.status !== 200 && uploadRes.status !== 201) {
    throw new Error(`youtube: ${await googleErrorMessage(uploadRes)}`);
  }

  let parsed: { id?: string };
  try {
    parsed = (await uploadRes.json()) as { id?: string };
  } catch (e) {
    throw new Error(`youtube: upload succeeded but response was unreadable — ${(e as Error)?.message ?? 'parse error'}`);
  }

  const videoId = parsed?.id;
  if (!videoId) {
    throw new Error('youtube: upload API returned no video id');
  }

  return { video_id: videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
}
