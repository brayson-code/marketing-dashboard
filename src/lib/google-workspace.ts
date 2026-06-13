// Google Workspace integration via Nango (provider 'google-workspace' → Google
// Drive / Docs / Sheets APIs). Creates folders, docs and sheets in the tenant's
// Drive, appends text/rows, and lists recent files — the write-and-organize
// surface that agents use to drop deliverables straight into a client's Drive.
//
// Nango handles the OAuth token + refresh — we never see the access token
// directly, and nothing here logs tokens. The integrator points the
// 'google-workspace' provider config key at the Nango 'google' integration and
// sets the Drive/Docs/Sheets scopes out of band (via NANGO_GOOGLE_WORKSPACE_CONFIG_KEY).
//
// Drive/Docs/Sheets live on three different hosts, so each call passes a FULL
// endpoint URL to the Nango proxy rather than a host-relative path. Failures
// bubble up as tagged Errors ('google-workspace: <cause>') so callers can show
// "Google Workspace hiccupped" vs. the actual API message. Fail closed: when the
// tenant isn't connected, every function throws a tagged error instead of acting.

import { getNango, providerConfigKeyFor } from './nango';
import { sql } from './db/client';
import { tenantId } from './tenant';

export const PROVIDER = 'google-workspace';

// Google API base hosts. Full endpoint URLs are built from these so the Nango
// proxy routes each call to the correct host (Drive vs Docs vs Sheets).
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DOCS_BASE = 'https://docs.googleapis.com/v1';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4';

export interface GWConn { connection_id: string; provider_config_key: string }

/** Look up this tenant's Google Workspace connection. Null if not connected.
 *  Exported so the Gmail/Calendar libs ride the SAME 'google-workspace' Nango
 *  connection instead of duplicating the lookup. */
export async function getConn(): Promise<GWConn | null> {
  const rows = (await sql()`
    SELECT connection_id, provider_config_key
    FROM connections
    WHERE tenant_id = ${tenantId()} AND provider = ${PROVIDER} AND status = 'connected'
    LIMIT 1
  `) as unknown as Array<{ connection_id: string; provider_config_key: string }>;
  const r = rows[0];
  if (!r?.connection_id) return null;
  return { connection_id: r.connection_id, provider_config_key: r.provider_config_key || providerConfigKeyFor(PROVIDER) };
}

/** True if this tenant has a connected Google Workspace — cheap check, no API call. */
export async function isWorkspaceConnected(): Promise<boolean> {
  return (await getConn()) !== null;
}

export interface ProxyOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;             // FULL URL, e.g. 'https://www.googleapis.com/drive/v3/files'
  // Nango's proxy params type doesn't accept boolean; no call site passes one.
  params?: Record<string, string | number | undefined>;
  data?: unknown;
}

/** Call a Google API endpoint through the Nango proxy. Throws a tagged Error on
 *  any failure (carrying Google's error message when the body has one) so callers
 *  can show "Google Workspace is unreachable" vs. their own error. Never logs the
 *  OAuth token — Nango injects it; we only ever see the endpoint + params.
 *
 *  Exported so the Gmail/Calendar libs proxy through the SAME connection + path.
 *  The `tag` param lets those libs surface their own prefix ('google-gmail: …')
 *  instead of 'google-workspace: …' while sharing all the connection logic. */
export async function gwProxy<T = unknown>(opts: ProxyOpts, tag = PROVIDER): Promise<T> {
  const nango = getNango();
  if (!nango) throw new Error(`${tag}: NANGO_SECRET_KEY not configured`);
  const conn = await getConn();
  if (!conn) throw new Error(`${tag}: not connected for this tenant`);

  // Trim empty params — Google rejects some keys with empty values.
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined && v !== null && v !== '') params[k] = v;

  try {
    // The Nango SDK proxy returns an axios-like response { data, status, … }.
    // We surface .data so callers get the parsed JSON directly.
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
  } catch (e) {
    // Google nests the useful message at response.data.error.message.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = (e as any)?.response?.data?.error?.message ?? (e as Error)?.message ?? 'request failed';
    throw new Error(`${tag}: ${msg}`);
  }
}

// Google Drive mime types for the file kinds we create.
const MIME = {
  folder: 'application/vnd.google-apps.folder',
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
} as const;

/** Web URL for a Drive file of a given mime type — Docs/Sheets get their native
 *  editor URLs; folders and everything else get the generic Drive view. */
function fileUrl(id: string, mimeType?: string): string {
  if (mimeType === MIME.document) return `https://docs.google.com/document/d/${id}/edit`;
  if (mimeType === MIME.spreadsheet) return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  if (mimeType === MIME.folder) return `https://drive.google.com/drive/folders/${id}`;
  return `https://drive.google.com/file/d/${id}/view`;
}

interface DriveFile { id?: string; name?: string; mimeType?: string; modifiedTime?: string }

/** Create a Drive file of a given mime type, optionally inside `parentId`.
 *  Returns the created file's id. Shared by the folder/doc/sheet creators. */
async function createDriveFile(name: string, mimeType: string, parentId?: string): Promise<string> {
  const body: { name: string; mimeType: string; parents?: string[] } = { name, mimeType };
  if (parentId) body.parents = [parentId];
  const r = await gwProxy<DriveFile>({
    method: 'POST',
    endpoint: `${DRIVE_BASE}/files`,
    params: { fields: 'id,mimeType' },
    data: body,
  });
  if (!r?.id) throw new Error('google-workspace: Drive files.create returned no id');
  return r.id;
}

// ── Folders ───────────────────────────────────────────────────────────────────

/** Create a Drive folder, optionally nested under `parentId`. */
export async function createFolder(name: string, parentId?: string): Promise<{ id: string; url: string }> {
  const title = name.trim();
  if (!title) throw new Error('google-workspace: folder name is required');
  const id = await createDriveFile(title, MIME.folder, parentId);
  return { id, url: fileUrl(id, MIME.folder) };
}

// ── Docs ──────────────────────────────────────────────────────────────────────

/** Insert plain text into a Google Doc at a given 1-based index (default: the
 *  document start, just after the implicit body section break). */
async function docInsertText(documentId: string, text: string, index: number): Promise<void> {
  await gwProxy({
    method: 'POST',
    endpoint: `${DOCS_BASE}/documents/${documentId}:batchUpdate`,
    data: { requests: [{ insertText: { location: { index }, text } }] },
  });
}

/** Read a Doc's current end-of-body index so we can append after existing content.
 *  The body's last structural element's endIndex is the insertion point minus one. */
async function docEndIndex(documentId: string): Promise<number> {
  interface DocResp { body?: { content?: Array<{ endIndex?: number }> } }
  const doc = await gwProxy<DocResp>({
    endpoint: `${DOCS_BASE}/documents/${documentId}`,
    params: { fields: 'body(content(endIndex))' },
  });
  const content = doc.body?.content ?? [];
  const last = content[content.length - 1];
  // Insert one before the final newline that Docs always keeps at the very end.
  const end = last?.endIndex ?? 1;
  return Math.max(1, end - 1);
}

/** Create a Google Doc (optionally inside `parentId`) and, if `text` is given,
 *  insert it at the top of the new document. */
export async function createDoc(title: string, text?: string, parentId?: string): Promise<{ id: string; url: string }> {
  const name = title.trim();
  if (!name) throw new Error('google-workspace: doc title is required');
  const id = await createDriveFile(name, MIME.document, parentId);
  if (text && text.length) {
    // A fresh doc has a single body section break; index 1 is the first writable spot.
    await docInsertText(id, text, 1);
  }
  return { id, url: fileUrl(id, MIME.document) };
}

/** Append plain text to the end of an existing Google Doc. */
export async function appendToDoc(documentId: string, text: string): Promise<{ id: string; url: string }> {
  if (!documentId) throw new Error('google-workspace: documentId is required');
  if (!text || !text.length) throw new Error('google-workspace: append text is required');
  const index = await docEndIndex(documentId);
  await docInsertText(documentId, text, index);
  return { id: documentId, url: fileUrl(documentId, MIME.document) };
}

// ── Sheets ──────────────────────────────────────────────────────────────────────

/** Create a Google Sheet (spreadsheet), optionally inside `parentId`. We create
 *  via Drive (so `parentId` placement works) rather than the Sheets create API. */
export async function createSheet(title: string, parentId?: string): Promise<{ id: string; url: string }> {
  const name = title.trim();
  if (!name) throw new Error('google-workspace: sheet title is required');
  const id = await createDriveFile(name, MIME.spreadsheet, parentId);
  return { id, url: fileUrl(id, MIME.spreadsheet) };
}

/** Append a single row of values to the first sheet of a spreadsheet. Values are
 *  sent as a single row; Sheets places them after the last row with data. */
export async function appendSheetRow(spreadsheetId: string, values: Array<string | number>): Promise<{ updatedRange: string }> {
  if (!spreadsheetId) throw new Error('google-workspace: spreadsheetId is required');
  if (!Array.isArray(values) || values.length === 0) throw new Error('google-workspace: row values are required');
  interface AppendResp { updates?: { updatedRange?: string } }
  const r = await gwProxy<AppendResp>({
    method: 'POST',
    // 'A1' lets Sheets resolve the first sheet + the table to append to.
    endpoint: `${SHEETS_BASE}/spreadsheets/${spreadsheetId}/values/A1:append`,
    params: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' },
    data: { values: [values] },
  });
  return { updatedRange: r.updates?.updatedRange ?? '' };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface GWFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  url: string;
}

/** Most-recently-modified files in the tenant's Drive, newest first. */
export async function listRecentFiles(limit = 10): Promise<GWFile[]> {
  interface ListResp { files?: DriveFile[] }
  const r = await gwProxy<ListResp>({
    endpoint: `${DRIVE_BASE}/files`,
    params: {
      pageSize: Math.max(1, Math.min(limit, 100)),
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,mimeType,modifiedTime)',
    },
  });
  return (r.files ?? [])
    .filter((f): f is DriveFile & { id: string } => !!f.id)
    .map((f) => ({
      id: f.id,
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
      modifiedTime: f.modifiedTime ?? '',
      url: fileUrl(f.id, f.mimeType),
    }));
}
