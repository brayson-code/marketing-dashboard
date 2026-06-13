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
  'gmail_list',
  'gmail_send',
  'gmail_draft',
  'cal_list',
  'cal_create_event',
  'meet_create_space',
  'meet_recent_transcript',
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

    // ── Gmail tools ────────────────────────────────────────────────────────────
    {
      name: 'gmail_list',
      description:
        'List recent messages from the connected Gmail account. ' +
        'Use to check the inbox for relevant threads, leads, or client replies ' +
        'before drafting a response or summarising email activity.',
      input_schema: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'Number of messages to return (default 10, max 50).',
          },
        },
      },
    },
    {
      name: 'gmail_send',
      description:
        'SEND a real email from the connected Google / Gmail account immediately — ' +
        'the message is delivered to the recipient right away and CANNOT be recalled. ' +
        'Use only when the task explicitly calls for sending an email on behalf of the user. ' +
        'Prefer gmail_draft when the user has not confirmed they want the email sent now.',
      input_schema: {
        type: 'object',
        required: ['to', 'subject', 'text'],
        properties: {
          to: {
            type: 'string',
            description: 'Recipient email address (or comma-separated list).',
          },
          subject: {
            type: 'string',
            description: 'Subject line of the email.',
          },
          text: {
            type: 'string',
            description: 'Plain-text body of the email.',
          },
        },
      },
    },
    {
      name: 'gmail_draft',
      description:
        'Save a draft email in the connected Gmail account (NOT sent). ' +
        'The draft sits in the Drafts folder; the user must open Gmail and send it manually. ' +
        'Use this instead of gmail_send whenever the task is to prepare an email for review ' +
        'rather than to deliver it immediately.',
      input_schema: {
        type: 'object',
        required: ['to', 'subject', 'text'],
        properties: {
          to: {
            type: 'string',
            description: 'Intended recipient email address (or comma-separated list).',
          },
          subject: {
            type: 'string',
            description: 'Subject line of the draft.',
          },
          text: {
            type: 'string',
            description: 'Plain-text body of the draft.',
          },
        },
      },
    },

    // ── Google Meet tools ──────────────────────────────────────────────────────
    {
      name: 'meet_create_space',
      description:
        'Create a new Google Meet meeting space and return a join URL the agent can share. ' +
        'Use this to generate an instant Meet link — drop it into a calendar invite body, ' +
        'an email, or a Slack message without opening Google Calendar. ' +
        'Returns the join URL (meeting_uri) and the short meeting code.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'meet_recent_transcript',
      description:
        'Fetch the transcript of the most recent Google Meet call that was recorded and ' +
        'transcribed. Use this to summarise a client call, extract action items, or pull ' +
        'key quotes from the latest meeting. Returns the joined transcript text with speaker ' +
        'names when available, or a message indicating no transcript exists.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },

    // ── Google Calendar tools ──────────────────────────────────────────────────
    {
      name: 'cal_list',
      description:
        'List upcoming events from the connected Google Calendar. ' +
        'Use to check for scheduling conflicts, surface deadlines, or summarise ' +
        'the week ahead before booking new events.',
      input_schema: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            description: 'Number of upcoming events to return (default 10, max 50).',
          },
        },
      },
    },
    {
      name: 'cal_create_event',
      description:
        'Create a new event in the connected Google Calendar. ' +
        'Use for scheduling calls, campaign deadlines, content reviews, or any ' +
        'time-blocked task. Optionally invite attendees by email.',
      input_schema: {
        type: 'object',
        required: ['summary', 'start', 'end'],
        properties: {
          summary: {
            type: 'string',
            description: 'Event title / name.',
          },
          description: {
            type: 'string',
            description: 'Optional event body / notes.',
          },
          start: {
            type: 'string',
            description: 'Start datetime in ISO 8601 format (e.g. "2026-06-20T10:00:00").',
          },
          end: {
            type: 'string',
            description: 'End datetime in ISO 8601 format (e.g. "2026-06-20T11:00:00").',
          },
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of attendee email addresses to invite.',
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

  switch (toolUse.name) {
    // ── gw_create_folder ────────────────────────────────────────────────────
    case 'gw_create_folder': {
      const name = String(input.name ?? '').trim();
      if (!name) return err_result(id, 'gw_create_folder: name is required');
      const parentFolderId = input.parent_folder_id ? String(input.parent_folder_id) : undefined;
      // Lazy import — only pulled when a tool is actually called.
      let gw: typeof import('./google-workspace');
      try {
        gw = await import('./google-workspace');
      } catch (err) {
        return err_result(id, `google-workspace: module not available — ${(err as Error).message}`);
      }
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
      let gw: typeof import('./google-workspace');
      try {
        gw = await import('./google-workspace');
      } catch (err) {
        return err_result(id, `google-workspace: module not available — ${(err as Error).message}`);
      }
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
      let gw: typeof import('./google-workspace');
      try {
        gw = await import('./google-workspace');
      } catch (err) {
        return err_result(id, `google-workspace: module not available — ${(err as Error).message}`);
      }
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
      let gw: typeof import('./google-workspace');
      try {
        gw = await import('./google-workspace');
      } catch (err) {
        return err_result(id, `google-workspace: module not available — ${(err as Error).message}`);
      }
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
      let gw: typeof import('./google-workspace');
      try {
        gw = await import('./google-workspace');
      } catch (err) {
        return err_result(id, `google-workspace: module not available — ${(err as Error).message}`);
      }
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
      let gw: typeof import('./google-workspace');
      try {
        gw = await import('./google-workspace');
      } catch (err) {
        return err_result(id, `google-workspace: module not available — ${(err as Error).message}`);
      }
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

    // ── gmail_list ──────────────────────────────────────────────────────────
    case 'gmail_list': {
      const limit = Math.max(1, Math.min(Number(input.limit ?? 10), 50));
      let gmail: typeof import('./google-gmail');
      try {
        gmail = await import('./google-gmail');
      } catch (err) {
        return err_result(id, `google-gmail: module not available — ${(err as Error).message}`);
      }
      try {
        const messages = await gmail.listRecentMessages(limit);
        if (!messages || messages.length === 0) {
          return ok_result(id, 'No recent messages found.');
        }
        const lines = messages.map((m, i) =>
          `${i + 1}. id:${m.id} — ${String(m.subject ?? '(no subject)')} — from:${String(m.from ?? '?')} — ${String(m.date ?? '')}`,
        );
        return ok_result(id, `Found ${messages.length} message(s):\n${lines.join('\n')}`);
      } catch (err) {
        return err_result(id, `gmail_list failed — ${(err as Error).message}`);
      }
    }

    // ── gmail_send ──────────────────────────────────────────────────────────
    case 'gmail_send': {
      const to = String(input.to ?? '').trim();
      const subject = String(input.subject ?? '').trim();
      const text = String(input.text ?? '').trim();
      if (!to) return err_result(id, 'gmail_send: to is required');
      if (!subject) return err_result(id, 'gmail_send: subject is required');
      if (!text) return err_result(id, 'gmail_send: text is required');
      let gmail: typeof import('./google-gmail');
      try {
        gmail = await import('./google-gmail');
      } catch (err) {
        return err_result(id, `google-gmail: module not available — ${(err as Error).message}`);
      }
      try {
        await gmail.sendMessage({ to, subject, text });
        await audit(sourceAgent, 'google.gmail_send', to, { subject });
        return ok_result(id, `Email sent to ${to} with subject "${subject}".`);
      } catch (err) {
        return err_result(id, `gmail_send failed — ${(err as Error).message}`);
      }
    }

    // ── gmail_draft ─────────────────────────────────────────────────────────
    case 'gmail_draft': {
      const to = String(input.to ?? '').trim();
      const subject = String(input.subject ?? '').trim();
      const text = String(input.text ?? '').trim();
      if (!to) return err_result(id, 'gmail_draft: to is required');
      if (!subject) return err_result(id, 'gmail_draft: subject is required');
      if (!text) return err_result(id, 'gmail_draft: text is required');
      let gmail: typeof import('./google-gmail');
      try {
        gmail = await import('./google-gmail');
      } catch (err) {
        return err_result(id, `google-gmail: module not available — ${(err as Error).message}`);
      }
      try {
        await gmail.createDraft({ to, subject, text });
        await audit(sourceAgent, 'google.gmail_draft', to, { subject });
        return ok_result(id, `Draft saved (NOT sent) to Gmail Drafts folder — to:${to}, subject:"${subject}".`);
      } catch (err) {
        return err_result(id, `gmail_draft failed — ${(err as Error).message}`);
      }
    }

    // ── cal_list ────────────────────────────────────────────────────────────
    case 'cal_list': {
      const limit = Math.max(1, Math.min(Number(input.limit ?? 10), 50));
      let cal: typeof import('./google-calendar');
      try {
        cal = await import('./google-calendar');
      } catch (err) {
        return err_result(id, `google-calendar: module not available — ${(err as Error).message}`);
      }
      try {
        const events = await cal.listUpcomingEvents(limit);
        if (!events || events.length === 0) {
          return ok_result(id, 'No upcoming events found.');
        }
        const lines = events.map((e, i) =>
          `${i + 1}. ${String(e.summary ?? '(no title)')} — start:${String(e.start ?? '?')} end:${String(e.end ?? '?')}`,
        );
        return ok_result(id, `Found ${events.length} upcoming event(s):\n${lines.join('\n')}`);
      } catch (err) {
        return err_result(id, `cal_list failed — ${(err as Error).message}`);
      }
    }

    // ── cal_create_event ────────────────────────────────────────────────────
    case 'cal_create_event': {
      const summary = String(input.summary ?? '').trim();
      const start = String(input.start ?? '').trim();
      const end = String(input.end ?? '').trim();
      if (!summary) return err_result(id, 'cal_create_event: summary is required');
      if (!start) return err_result(id, 'cal_create_event: start is required');
      if (!end) return err_result(id, 'cal_create_event: end is required');
      const description = input.description ? String(input.description) : undefined;
      const attendees = Array.isArray(input.attendees)
        ? (input.attendees as unknown[]).map(String).filter(Boolean)
        : undefined;
      let cal: typeof import('./google-calendar');
      try {
        cal = await import('./google-calendar');
      } catch (err) {
        return err_result(id, `google-calendar: module not available — ${(err as Error).message}`);
      }
      try {
        await cal.createEvent({ summary, description, start, end, attendees });
        await audit(sourceAgent, 'google.cal_create_event', summary, { start, end, attendees });
        return ok_result(
          id,
          `Event created: "${summary}" from ${start} to ${end}` +
            (attendees && attendees.length > 0 ? ` — invited: ${attendees.join(', ')}` : '') +
            '.',
        );
      } catch (err) {
        return err_result(id, `cal_create_event failed — ${(err as Error).message}`);
      }
    }

    // ── meet_create_space ───────────────────────────────────────────────────
    case 'meet_create_space': {
      let meet: typeof import('./google-meet');
      try {
        meet = await import('./google-meet');
      } catch (err) {
        return err_result(id, `google-meet: module not available — ${(err as Error).message}`);
      }
      try {
        const space = await meet.createMeetingSpace();
        await audit(sourceAgent, 'google.meet_create_space', space.meeting_uri, {
          space_id: space.space_id,
          meeting_code: space.meeting_code,
        });
        return ok_result(
          id,
          `Meet link created:\nJoin URL: ${space.meeting_uri}` +
            (space.meeting_code ? `\nMeeting code: ${space.meeting_code}` : '') +
            `\nSpace: ${space.space_id}`,
        );
      } catch (err) {
        return err_result(id, `meet_create_space failed — ${(err as Error).message}`);
      }
    }

    // ── meet_recent_transcript ──────────────────────────────────────────────
    case 'meet_recent_transcript': {
      let meet: typeof import('./google-meet');
      try {
        meet = await import('./google-meet');
      } catch (err) {
        return err_result(id, `google-meet: module not available — ${(err as Error).message}`);
      }
      try {
        const result = await meet.getLatestTranscriptText();
        if (!result) {
          return ok_result(
            id,
            'No transcript found. Either no recent Meet recordings exist, or transcription was not enabled for the last call.',
          );
        }
        return ok_result(
          id,
          `Transcript for conference ${result.conference_id}:\n\n${result.text}`,
        );
      } catch (err) {
        return err_result(id, `meet_recent_transcript failed — ${(err as Error).message}`);
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
