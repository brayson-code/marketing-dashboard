// Instagram Content Publishing API — publish a Reel to the tenant's connected
// Instagram Business / Creator account.
//
// Uses the same Nango proxy pattern as instagram.ts (connection_id == tenant_id,
// provider 'instagram', proxy through /v19.0/*). Private helpers are self-contained
// here; instagram.ts is NOT imported so this file has no circular risk.
//
// Flow:
//   1. Resolve IG user id  (GET /v19.0/me?fields=id)
//   2. Create container    (POST /v19.0/<ig_user_id>/media)
//   3. Poll status_code    (GET  /v19.0/<container_id>?fields=status_code,status)
//        until FINISHED, ERROR, or EXPIRED — or ~3.5 min timeout.
//   4. Publish             (POST /v19.0/<ig_user_id>/media_publish)
//   5. Best-effort permalink fetch (non-fatal)
//
// Scope/permission errors (OAuthException / PermissionsError from Meta) are
// caught and re-thrown as a user-actionable tagged error telling them to
// reconnect via /connections.

import { getNango, providerConfigKeyFor } from './nango';
import { sql } from './db/client';
import { tenantId } from './tenant';

const PROVIDER = 'instagram';

// ── Private Nango proxy helpers (mirrors instagram.ts; NOT imported from there) ─

interface IGConn { connection_id: string; provider_config_key: string }

async function getConn(): Promise<IGConn | null> {
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

interface ProxyOpts {
  method?: 'GET' | 'POST';
  endpoint: string;
  params?: Record<string, string | number | undefined>;
  data?: unknown;
}

async function igProxy<T = unknown>(opts: ProxyOpts): Promise<T> {
  const nango = getNango();
  if (!nango) throw new Error('instagram: NANGO_SECRET_KEY not configured');
  const conn = await getConn();
  if (!conn) throw new Error('instagram: not connected for this tenant');

  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== null && v !== '') params[k] = v;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await nango.proxy({
    method: opts.method ?? 'GET',
    endpoint: opts.endpoint,
    providerConfigKey: conn.provider_config_key,
    connectionId: conn.connection_id,
    params: Object.keys(params).length ? params : undefined,
    data: opts.data,
  });
  return res?.data as T;
}

// ── Scope/permission error detection ────────────────────────────────────────

/** Return true when the error looks like a Meta OAuthException or a
 *  permissions / scope rejection — i.e. something a reconnect can fix. */
function isPermissionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Meta Graph errors we've seen: OAuthException, (#200) Permissions error,
  // "instagram_business_content_publish" missing scope, "invalid oauth access token".
  return (
    msg.includes('oauthexception') ||
    msg.includes('permissions error') ||
    msg.includes('permission') ||
    msg.includes('instagram_business_content_publish') ||
    msg.includes('invalid oauth') ||
    msg.includes('access token') ||
    // Nango surfaces 400/403 from the upstream as Error messages containing the
    // HTTP status; a 403 from the IG Graph almost always means missing scope.
    (msg.includes('403') && msg.includes('instagram'))
  );
}

// ── Polling constants ────────────────────────────────────────────────────────

/** Delay between container status polls, in ms. */
const POLL_INTERVAL_MS = 5_000;

/** Maximum total polling time before we give up and tell the user to retry. */
const POLL_TIMEOUT_MS = 3.5 * 60 * 1_000; // 3.5 minutes

// ── Public API ───────────────────────────────────────────────────────────────

export interface PublishReelResult {
  media_id: string;
  permalink: string | null;
}

/**
 * Publish a Reel to the tenant's connected Instagram Business / Creator account.
 *
 * @param opts.videoUrl  Publicly fetchable MP4 URL (e.g. a Vercel Blob public URL).
 *                       Meta's servers must be able to download it; signed / expiring
 *                       URLs that expire before the container finishes will cause ERROR.
 * @param opts.caption   Optional caption text (hashtags included). Defaults to ''.
 *
 * Throws a tagged Error on all failures:
 *   - "instagram: not connected …"          — no connected account for this tenant
 *   - "instagram: scope/permission error …" — missing publish scope; reconnect at /connections
 *   - "instagram: container error …"        — Meta rejected the video (bad format, etc.)
 *   - "instagram: container timed out …"    — took >3.5 min; container may still finish
 *   - "instagram: publish returned no id"   — unexpected empty response from media_publish
 */
export async function publishReel(
  opts: { videoUrl: string; caption?: string },
): Promise<PublishReelResult> {
  // ── 1. Resolve IG user id ──────────────────────────────────────────────────
  let igUserId: string;
  try {
    interface MeResp { id?: string }
    const me = await igProxy<MeResp>({ endpoint: '/v19.0/me', params: { fields: 'id' } });
    if (!me?.id) throw new Error('instagram: /me returned no id');
    igUserId = me.id;
  } catch (err) {
    if (isPermissionError(err)) {
      throw new Error(
        'instagram: scope/permission error resolving account — the connected Instagram account ' +
        'is missing the instagram_business_content_publish permission. ' +
        'Please reconnect Instagram at /connections to grant publish access.',
      );
    }
    throw err;
  }

  // ── 2. Create the Reel container ──────────────────────────────────────────
  let containerId: string;
  try {
    interface ContainerResp { id?: string }
    const container = await igProxy<ContainerResp>({
      method: 'POST',
      endpoint: `/v19.0/${igUserId}/media`,
      data: {
        media_type: 'REELS',
        video_url: opts.videoUrl,
        caption: opts.caption ?? '',
      },
    });
    if (!container?.id) throw new Error('instagram: container creation returned no id');
    containerId = container.id;
  } catch (err) {
    if (isPermissionError(err)) {
      throw new Error(
        'instagram: scope/permission error creating Reel container — ' +
        'the connected account is missing publish permissions. ' +
        'Please reconnect Instagram at /connections.',
      );
    }
    throw err;
  }

  // ── 3. Poll until FINISHED (or ERROR / EXPIRED / timeout) ─────────────────
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (true) {
    // Honour the deadline before sleeping so a fast FINISHED is caught immediately.
    if (Date.now() > deadline) {
      throw new Error(
        `instagram: container timed out after ~${POLL_TIMEOUT_MS / 60_000} minutes ` +
        `(container_id=${containerId}). The container may still finish on Meta's side. ` +
        'Retrying publish will create a new container — this is acceptable for v1.',
      );
    }

    // Short sleep between polls (skip on the very first iteration so an already-
    // fast encode path doesn't waste 5 s unnecessarily — but the API itself takes
    // at least a few seconds to process, so this is just a minor nicety).
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    interface StatusResp { status_code?: string; status?: string }
    let poll: StatusResp;
    try {
      poll = await igProxy<StatusResp>({
        endpoint: `/v19.0/${containerId}`,
        params: { fields: 'status_code,status' },
      });
    } catch (err) {
      if (isPermissionError(err)) {
        throw new Error(
          'instagram: scope/permission error polling container status — ' +
          'please reconnect Instagram at /connections.',
        );
      }
      // Transient network error — log and keep polling.
      console.warn('[instagram-publish] transient error polling container:', (err as Error).message);
      continue;
    }

    const statusCode = poll?.status_code ?? '';
    const detail = poll?.status ?? '';

    if (statusCode === 'FINISHED') break; // ready to publish

    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(
        `instagram: container ${statusCode.toLowerCase()} — ${detail || 'no detail from Meta'} ` +
        `(container_id=${containerId}). Check that the video URL is publicly reachable and the ` +
        'file is a valid MP4.',
      );
    }

    // IN_PROGRESS / PUBLISHED / other transient states — keep polling.
  }

  // ── 4. Publish the container ───────────────────────────────────────────────
  let mediaId: string;
  try {
    interface PublishResp { id?: string }
    const published = await igProxy<PublishResp>({
      method: 'POST',
      endpoint: `/v19.0/${igUserId}/media_publish`,
      data: { creation_id: containerId },
    });
    if (!published?.id) throw new Error('instagram: publish returned no id');
    mediaId = published.id;
  } catch (err) {
    if (isPermissionError(err)) {
      throw new Error(
        'instagram: scope/permission error publishing Reel — ' +
        'please reconnect Instagram at /connections.',
      );
    }
    throw err;
  }

  // ── 5. Best-effort permalink fetch ────────────────────────────────────────
  let permalink: string | null = null;
  try {
    interface PermalinkResp { permalink?: string }
    const meta = await igProxy<PermalinkResp>({
      endpoint: `/v19.0/${mediaId}`,
      params: { fields: 'permalink' },
    });
    permalink = meta?.permalink ?? null;
  } catch {
    // Non-fatal — the Reel is published; we just can't surface a direct link yet.
  }

  return { media_id: mediaId, permalink };
}
