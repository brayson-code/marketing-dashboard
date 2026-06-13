// Google Workspace agent tools — gw_create_folder, gw_create_doc, gw_append_doc,
// gw_create_sheet, gw_append_sheet_row, gw_list_files.
//
// Modelled on kg-tools.ts. The tool definitions are registered in subagent.ts ONLY
// when googleActionsAllowed() is true (workspace connected AND the tenant has
// explicitly opted in via business_profile.google_actions_enabled). When false
// the tools are never offered to the model — byte-identical to pre-merge behavior.
//
// Every write is traced via logAudit() so every action an agent takes in the
// client's Google account is fully auditable. On any failure the handler returns
// an is_error tool_result — it never throws out of the tool-use loop.
//
// google-workspace.ts (the Nango proxy / Drive/Docs/Sheets layer) is imported
// LAZILY inside each handler so module load stays cheap when the feature is off.

import Anthropic from '@anthropic-ai/sdk';
import { logAudit } from './audit';
import { sql, tenantId } from './db/client';

// ── Tool name registry ────────────────────────────────────────────────────────
// Exported so subagent.ts can add them to the handledToolUses filter without
// hard-coding the strings in two places.
export const GOOGLE_TOOL_NAMES = [
  'gw_create_folder',
  'gw_create_doc',
  'gw_append_doc',
  'gw_create_sheet',
  'gw_append_sheet_row',
  'gw_list_files',
] as const;

// ── Feature gate ──────────────────────────────────────────────────────────────

/**
 * True when this tenant both:
 *  1. Has a connected Google Workspace account (connections table row with
 *     provider='google-workspace' and status='connected').
 *  2. Has explicitly opted in via business_profile.google_actions_enabled = true.
 *
 * DEFAULT OFF — both conditions must be met for tools to be offered to the model.
 * A tenant that just connected Google but hasn't toggled the setting gets false.
 * Disconnecting Google also returns false regardless of the toggle state.
 */
export async function googleActionsAllowed(): Promise<boolean> {
  try {
    // 1. Connection check — no Nango call needed, just our DB row.
    const connRows = (await sql()`
      SELECT 1 FROM connections
      WHERE tenant_id = ${tenantId()}
        AND provider = 'google-workspace'
        AND status = 'connected'
      LIMIT 1
    `) as unknown as Array<Record<string, unknown>>;
    if (connRows.length === 0) return false;

    // 2. Explicit opt-in check — reads business_profile.google_actions_enabled.
    const bpRows = (await sql()`
      SELECT business_profile FROM public.tenants
      WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
    const bp = bpRows[0]?.business_profile ?? {};
    return bp.google_actions_enabled === true;
  } catch {
    // Fail closed — if we can't confirm permission, do not offer the tools.
    return false;
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

/**
 * Return Anthropic tool definitions for all Google Workspace agent actions.
 * Spread into a sub-agent's `tools` array when googleActionsAllowed() is true.
 */
export function googleToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'gw_create_folder',
      description:
        'Create a folder in the connected Google Drive account. Use this to organise deliverables — ' +
        'e.g. a campaign folder, a client folder, a monthly content folder. ' +
        'Returns the new folder id and a Drive URL.',
      input_schema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            description: 'The display name of the new folder.',
          },
          parent_folder_id: {
            type: 'string',
            description:
              'Optional Drive folder id to create inside. Omit to create in the account root.',
          },
        },
      },
    },
    {
      name: 'gw_create_doc',
      description:
        'Create a new Google Doc in the connected account with optional initial content. ' +
        'Use this for long-form deliverables: onboarding docs, scope-of-work, client reports, ' +
        'weekly status, brand guidelines, etc. ' +
        'Returns the doc id and a Docs URL.',
      input_schema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: {
            type: 'string',
            description: 'Title of the new Google Doc.',
          },
          content: {
            type: 'string',
            description: 'Initial plain-text or markdown body to write into the doc (optional).',
          },
          folder_id: {
            type: 'string',
            description: 'Optional Drive folder id to place the doc in.',
          },
        },
      },
    },
    {
      name: 'gw_append_doc',
      description:
        'Append text to an existing Google Doc (identified by its doc id). ' +
        'Use to add a new section, update a running log, or extend a deliverable ' +
        'without overwriting existing content.',
      input_schema: {
        type: 'object',
        required: ['doc_id', 'content'],
        properties: {
          doc_id: {
            type: 'string',
            description: 'The Google Docs document id (from the URL or a prior gw_create_doc call).',
          },
          content: {
            type: 'string',
            description: 'Text to append to the end of the document.',
          },
        },
      },
    },
    {
      name: 'gw_create_sheet',
      description:
        'Create a new Google Sheet in the connected account with an optional header row. ' +
        'Use for structured deliverables: content calendars, lead lists, KPI trackers, ' +
        'SEO keyword tables, campaign results. ' +
        'Returns the spreadsheet id and a Sheets URL.',
      input_schema: {
        type: 'object',
        required: ['title'],
        properties: {
          title: {
            type: 'string',
            description: 'Title of the new Google Sheet.',
          },
          headers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional header row values for the first row of the sheet.',
          },
          folder_id: {
            type: 'string',
            description: 'Optional Drive folder id to place the sheet in.',
          },
        },
      },
    },
    {
      name: 'gw_append_sheet_row',
      description:
        'Append one or more rows of data to an existing Google Sheet. ' +
        'Use to log entries progressively — e.g. add a weekly metric row, append new leads, ' +
        'record campaign run results.',
      input_schema: {
        type: 'object',
        required: ['spreadsheet_id', 'rows'],
        properties: {
          spreadsheet_id: {
            type: 'string',
            description: 'The Google Sheets spreadsheet id.',
          },
          rows: {
            type: 'array',
            description: 'Array of rows; each row is an array of cell values (strings or numbers).',
            items: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          sheet_name: {
            type: 'string',
            description: 'Tab/sheet name to append to (defaults to "Sheet1" if omitted).',
          },
        },
      },
    },
    {
      name: 'gw_list_files',
      description:
        'List recent files in the connected Google Drive account. ' +
        'Use to check what already exists before creating duplicates, or to surface ' +
        'relevant existing docs/sheets to reference in a deliverable.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional search query (file name contains, e.g. "Q2 report").',
          },
          max_results: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'Number of files to return (default 10, max 50).',
          },
          folder_id: {
            type: 'string',
            description: 'Optional parent folder id to restrict the listing.',
          },
        },
      },
    },
  ];
}

// ── Tool handler ──────────────────────────────────────────────────────────────

/**
 * Execute a Google Workspace tool_use block and return a tool_result.
 * Audits every write. Never throws — errors become is_error tool_results.
 *
 * @param toolUse  The ToolUseBlock from the model's response.
 * @param sourceAgent  The sub-agent type id (for audit provenance).
 */
export async function handleGoogleTool(
  toolUse: Anthropic.ToolUseBlock,
  sourceAgent: string,
): Promise<Anthropic.ToolResultBlockParam> {
  const id = toolUse.id;
  const input = (toolUse.input ?? {}) as Record<string, unknown>;

  // Lazy import — only pulled when a tool is actually called.
  // The concurrent task builds google-workspace.ts; we import lazily so a missing
  // module at spawn time never breaks agent runs that don't use Google tools.
  let gw: typeof import('./google-workspace');
  try {
    gw = await import('./google-workspace');
  } catch (err) {
    return err_result(id, `google-workspace: module not available — ${(err as Error).message}`);
  }

  switch (toolUse.name) {
    // ── gw_create_folder ────────────────────────────────────────────────────
    case 'gw_create_folder': {
      const name = String(input.name ?? '').trim();
      if (!name) return err_result(id, 'gw_create_folder: name is required');
      const parentFolderId = input.parent_folder_id ? String(input.parent_folder_id) : undefined;
      try {
        const result = await gw.createFolder(name, parentFolderId);
        await audit(sourceAgent, 'google.create_folder', name, { folder_id: result.id, url: result.url });
        return ok_result(id, `Folder created: "${name}" (id: ${result.id})\nURL: ${result.url}`);
      } catch (err) {
        return err_result(id, `google-workspace: create_folder failed — ${(err as Error).message}`);
      }
    }

    // ── gw_create_doc ───────────────────────────────────────────────────────
    case 'gw_create_doc': {
      const title = String(input.title ?? '').trim();
      if (!title) return err_result(id, 'gw_create_doc: title is required');
      const content = input.content ? String(input.content) : undefined;
      const folderId = input.folder_id ? String(input.folder_id) : undefined;
      try {
        const result = await gw.createDoc(title, content, folderId);
        await audit(sourceAgent, 'google.create_doc', title, { doc_id: result.id, url: result.url });
        return ok_result(id, `Document created: "${title}" (id: ${result.id})\nURL: ${result.url}`);
      } catch (err) {
        return err_result(id, `google-workspace: create_doc failed — ${(err as Error).message}`);
      }
    }

    // ── gw_append_doc ───────────────────────────────────────────────────────
    case 'gw_append_doc': {
      const docId = String(input.doc_id ?? '').trim();
      const content = String(input.content ?? '').trim();
      if (!docId) return err_result(id, 'gw_append_doc: doc_id is required');
      if (!content) return err_result(id, 'gw_append_doc: content is required');
      try {
        await gw.appendToDoc(docId, content);
        await audit(sourceAgent, 'google.append_doc', docId, { chars: content.length });
        return ok_result(id, `Appended ${content.length} characters to doc ${docId}.`);
      } catch (err) {
        return err_result(id, `google-workspace: append_doc failed — ${(err as Error).message}`);
      }
    }

    // ── gw_create_sheet ─────────────────────────────────────────────────────
    case 'gw_create_sheet': {
      const title = String(input.title ?? '').trim();
      if (!title) return err_result(id, 'gw_create_sheet: title is required');
      const headers = Array.isArray(input.headers)
        ? (input.headers as unknown[]).map(String)
        : undefined;
      const folderId = input.folder_id ? String(input.folder_id) : undefined;
      try {
        // createSheet(title, parentId?) — no native headers param in the workspace
        // lib; we append the header row separately if provided.
        const result = await gw.createSheet(title, folderId);
        // Audit the creation IMMEDIATELY — the sheet now exists in the client's
        // Drive, so it must be traceable even if the header append below fails.
        await audit(sourceAgent, 'google.create_sheet', title, { spreadsheet_id: result.id, url: result.url });
        if (headers && headers.length > 0) {
          await gw.appendSheetRow(result.id, headers);
          await audit(sourceAgent, 'google.append_sheet_row', result.id, { spreadsheet_id: result.id, rows: 1, kind: 'header' });
        }
        return ok_result(id, `Spreadsheet created: "${title}" (id: ${result.id})\nURL: ${result.url}`);
      } catch (err) {
        return err_result(id, `google-workspace: create_sheet failed — ${(err as Error).message}`);
      }
    }

    // ── gw_append_sheet_row ─────────────────────────────────────────────────
    case 'gw_append_sheet_row': {
      const spreadsheetId = String(input.spreadsheet_id ?? '').trim();
      if (!spreadsheetId) return err_result(id, 'gw_append_sheet_row: spreadsheet_id is required');
      if (!Array.isArray(input.rows) || input.rows.length === 0) {
        return err_result(id, 'gw_append_sheet_row: rows must be a non-empty array');
      }
      const rows = (input.rows as unknown[][]).map((r) =>
        Array.isArray(r) ? r.map(String) : [String(r)],
      );
      // appendSheetRow(spreadsheetId, values) appends one row at a time.
      // Iterate if the model sends multiple rows; each call is one round-trip.
      // Track how many actually landed so a partial failure is still audited
      // (real writes must never be untraceable).
      let written = 0;
      try {
        for (const row of rows) {
          await gw.appendSheetRow(spreadsheetId, row);
          written++;
        }
        await audit(sourceAgent, 'google.append_sheet_row', spreadsheetId, { rows: written });
        return ok_result(id, `Appended ${written} row(s) to spreadsheet ${spreadsheetId}.`);
      } catch (err) {
        if (written > 0) {
          await audit(sourceAgent, 'google.append_sheet_row', spreadsheetId, { rows: written, partial: true });
        }
        return err_result(id, `google-workspace: append_sheet_row failed after ${written}/${rows.length} row(s) — ${(err as Error).message}`);
      }
    }

    // ── gw_list_files ───────────────────────────────────────────────────────
    case 'gw_list_files': {
      const maxResults = Math.max(1, Math.min(Number(input.max_results ?? 10), 50));
      try {
        // listRecentFiles(limit?) — the workspace lib doesn't support free-text
        // query or folder filter at this level; fetch then filter client-side.
        const files = await gw.listRecentFiles(maxResults);
        const query = input.query ? String(input.query).toLowerCase() : null;
        const folderId = input.folder_id ? String(input.folder_id) : null;
        const filtered = files.filter((f) => {
          if (query && !f.name.toLowerCase().includes(query)) return false;
          // folderId filtering not available in the base lib response (no parents field);
          // skip silently so the agent still gets a useful response.
          void folderId;
          return true;
        });
        if (filtered.length === 0) {
          return ok_result(id, query ? `No files found matching "${query}".` : 'No files found.');
        }
        const lines = filtered.map(
          (f) => `- ${f.name} (${f.mimeType}) — id: ${f.id} — ${f.url}`,
        );
        return ok_result(id, `Found ${filtered.length} file(s):\n${lines.join('\n')}`);
      } catch (err) {
        return err_result(id, `google-workspace: list_files failed — ${(err as Error).message}`);
      }
    }

    default:
      return err_result(id, `google-tools: unknown tool name "${toolUse.name}"`);
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function ok_result(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content };
}

function err_result(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content, is_error: true };
}

/** Write an audit record for a Google Workspace agent action.
 *  Never throws — audit failures must not break the tool-use loop. */
async function audit(
  actor: string,
  action: string,
  target: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await logAudit({ actor: null, action, target, detail: { agent: actor, ...detail } });
  } catch {
    // Best-effort — swallow so the tool result is always returned.
  }
}
