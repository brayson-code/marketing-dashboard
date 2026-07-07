// Jobber agent tools — read the tenant's Jobber CRM (clients, quotes, jobs,
// invoices) and, when explicitly enabled, draft a quote.
//
// Mirrors firecrawl-tools.ts / sms-tools.ts. The READ tools are ALWAYS registered:
// when the tenant hasn't connected Jobber the handler returns a friendly
// "connect it on the Connections page" payload (NOT an error) so the agent relays
// it cleanly. The single WRITE tool (jobber_create_quote_draft) is registered ONLY
// when JOBBER_WRITE_ENABLED === 'true' (default OFF) — quote drafts always still
// require human review/approval inside Jobber. The handler never throws out of the
// tool-use loop and never leaks a token.
//
// Wiring (see [[orchestrator-tool-wiring]]): JOBBER_TOOL_NAMES must be added in
// FOUR places for KeyPlayer — buildTools defs, CLIENT_TOOL_NAMES, the
// handleClientToolUse dispatch, and a prompt-awareness block — plus the
// subagent.ts filter + defs. Missing the CLIENT_TOOL_NAMES one yields
// "Orchestrator produced no text reply" and the tool silently never runs.

import Anthropic from '@anthropic-ai/sdk';
import {
  JobberNotConnectedError,
  listClients,
  getClient,
  listQuotes,
  listJobs,
  listInvoices,
  createQuoteDraft,
  type JobberClientSummary,
  type JobberQuoteSummary,
  type JobberJobSummary,
  type JobberInvoiceSummary,
} from './jobber';

export const JOBBER_READ_TOOL_NAMES = [
  'jobber_list_clients',
  'jobber_get_client',
  'jobber_list_quotes',
  'jobber_list_jobs',
  'jobber_list_invoices',
] as const;

export const JOBBER_WRITE_TOOL_NAMES = ['jobber_create_quote_draft'] as const;

// The full set is recognized by CLIENT_TOOL_NAMES regardless of the write flag —
// recognizing a name that's never registered is harmless; NOT recognizing a
// registered one bails the whole turn with no text reply.
export const JOBBER_TOOL_NAMES = new Set<string>([...JOBBER_READ_TOOL_NAMES, ...JOBBER_WRITE_TOOL_NAMES]);

/** Quote drafting is a WRITE — gated OFF by default. When off the tool is never
 *  registered and the prompt tells the agent quote-drafting isn't enabled yet. */
export function jobberWriteEnabled(): boolean {
  return process.env.JOBBER_WRITE_ENABLED === 'true';
}

export function jobberToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  const defs: Anthropic.Messages.ToolUnion[] = [
    {
      name: 'jobber_list_clients',
      description:
        'List clients from the connected Jobber CRM, optionally filtered by a search term ' +
        '(name, company, email). Read-only. Returns each client’s id, name, and company — ' +
        'NOT contact points; use the returned id with jobber_get_client for emails/phones.',
      input_schema: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Optional search term to match name / company / email.' },
          limit: { type: 'number', description: 'Max clients to return (default 10, max 100).' },
        },
      },
    },
    {
      name: 'jobber_get_client',
      description:
        'Fetch ONE Jobber client by id (as returned by jobber_list_clients) with contact detail ' +
        '(emails, phones, company). Read-only.',
      input_schema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'The Jobber client id.' },
        },
      },
    },
    {
      name: 'jobber_list_quotes',
      description:
        'List quotes from the connected Jobber CRM, optionally filtered by status (e.g. draft, ' +
        'awaiting_response, approved, converted, archived). Read-only. Returns id, number, status, ' +
        'client, total, and dates.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Optional status filter, e.g. "draft" or "approved".' },
          limit: { type: 'number', description: 'Max quotes to return (default 10, max 100).' },
        },
      },
    },
    {
      name: 'jobber_list_jobs',
      description:
        'List jobs from the connected Jobber CRM. Read-only. Returns id, number, title, status, ' +
        'client, total, and start/end dates.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max jobs to return (default 10, max 100).' },
        },
      },
    },
    {
      name: 'jobber_list_invoices',
      description:
        'List invoices from the connected Jobber CRM, optionally filtered by status (e.g. draft, ' +
        'sent, paid, past_due, bad_debt). Read-only. Returns id, number, subject, status, client, ' +
        'total, and dates.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Optional status filter, e.g. "sent" or "paid".' },
          limit: { type: 'number', description: 'Max invoices to return (default 10, max 100).' },
        },
      },
    },
  ];

  if (jobberWriteEnabled()) {
    defs.push({
      name: 'jobber_create_quote_draft',
      description:
        'Create a DRAFT quote in Jobber for a client with the given line items. This does NOT send ' +
        'the quote — it only drafts it; a human must review and approve/send it inside Jobber. ' +
        'Use jobber_list_clients / jobber_get_client first to get the correct client id.',
      input_schema: {
        type: 'object',
        required: ['client_id', 'line_items'],
        properties: {
          client_id: { type: 'string', description: 'The Jobber client id the quote is for.' },
          line_items: {
            type: 'array',
            description: 'The quote line items.',
            items: {
              type: 'object',
              required: ['name', 'quantity', 'unit_price'],
              properties: {
                name: { type: 'string', description: 'Line item name / service.' },
                description: { type: 'string', description: 'Optional longer description.' },
                quantity: { type: 'number', description: 'Quantity (e.g. 1).' },
                unit_price: { type: 'number', description: 'Price per unit in the account currency.' },
              },
            },
          },
        },
      },
    });
  }

  return defs;
}

// ── result helpers ──────────────────────────────────────────────────────────

function ok(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content };
}
function err(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content, is_error: true };
}

const NOT_CONNECTED_MSG =
  "Jobber isn't connected — connect it on the Connections page, then try again.";

function money(n: number | null): string {
  return n == null ? '—' : `$${n.toFixed(2)}`;
}
function fmtClient(c: JobberClientSummary): string {
  const parts = [`${c.name} (id: ${c.id})`];
  if (c.companyName && c.companyName !== c.name) parts.push(c.companyName);
  if (c.emails.length) parts.push(c.emails.join(', '));
  if (c.phones.length) parts.push(c.phones.join(', '));
  return `- ${parts.join(' — ')}`;
}
function fmtQuote(q: JobberQuoteSummary): string {
  return `- Quote #${q.number ?? q.id} — ${q.status ?? 'unknown'} — ${q.clientName ?? 'no client'} — ${money(q.total)}`;
}
function fmtJob(j: JobberJobSummary): string {
  return `- Job #${j.number ?? j.id} — ${j.title ?? 'untitled'} — ${j.status ?? 'unknown'} — ${j.clientName ?? 'no client'} — ${money(j.total)}`;
}
function fmtInvoice(i: JobberInvoiceSummary): string {
  return `- Invoice #${i.number ?? i.id} — ${i.status ?? 'unknown'} — ${i.clientName ?? 'no client'} — ${money(i.total)}${i.dueDate ? ` — due ${i.dueDate}` : ''}`;
}

interface LineItemIn {
  name?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
}

/**
 * Execute a Jobber tool_use block and return a tool_result. Never throws — a
 * missing connection becomes a clear "connect Jobber" message (non-error) and any
 * other failure becomes an is_error tool_result. Never leaks a token.
 *
 * `sourceAgent` is accepted for parity with the other tool handlers; these tools
 * don't branch on it today.
 */
export async function handleJobberTool(
  toolUse: Anthropic.ToolUseBlock,
  _sourceAgent = 'keyplayer',
): Promise<Anthropic.ToolResultBlockParam> {
  void _sourceAgent;
  const id = toolUse.id;
  const input = (toolUse.input ?? {}) as Record<string, unknown>;

  try {
    switch (toolUse.name) {
      case 'jobber_list_clients': {
        const search = typeof input.search === 'string' ? input.search : undefined;
        const limit = typeof input.limit === 'number' ? input.limit : undefined;
        const clients = await listClients(search, limit);
        if (clients.length === 0) return ok(id, search ? `No Jobber clients matched "${search}".` : 'No Jobber clients found.');
        return ok(id, `${clients.length} client(s):\n${clients.map(fmtClient).join('\n')}`);
      }
      case 'jobber_get_client': {
        const clientId = String(input.id ?? '').trim();
        if (!clientId) return err(id, 'jobber_get_client: `id` is required.');
        const client = await getClient(clientId);
        if (!client) return ok(id, `No Jobber client found with id ${clientId}.`);
        return ok(id, fmtClient(client).replace(/^- /, ''));
      }
      case 'jobber_list_quotes': {
        const status = typeof input.status === 'string' ? input.status : undefined;
        const limit = typeof input.limit === 'number' ? input.limit : undefined;
        const quotes = await listQuotes({ status, limit });
        if (quotes.length === 0) return ok(id, status ? `No Jobber quotes with status "${status}".` : 'No Jobber quotes found.');
        return ok(id, `${quotes.length} quote(s):\n${quotes.map(fmtQuote).join('\n')}`);
      }
      case 'jobber_list_jobs': {
        const limit = typeof input.limit === 'number' ? input.limit : undefined;
        const jobs = await listJobs({ limit });
        if (jobs.length === 0) return ok(id, 'No Jobber jobs found.');
        return ok(id, `${jobs.length} job(s):\n${jobs.map(fmtJob).join('\n')}`);
      }
      case 'jobber_list_invoices': {
        const status = typeof input.status === 'string' ? input.status : undefined;
        const limit = typeof input.limit === 'number' ? input.limit : undefined;
        const invoices = await listInvoices({ status, limit });
        if (invoices.length === 0) return ok(id, status ? `No Jobber invoices with status "${status}".` : 'No Jobber invoices found.');
        return ok(id, `${invoices.length} invoice(s):\n${invoices.map(fmtInvoice).join('\n')}`);
      }
      case 'jobber_create_quote_draft': {
        if (!jobberWriteEnabled()) {
          return err(id, 'jobber_create_quote_draft is not enabled in this workspace.');
        }
        const clientId = String(input.client_id ?? '').trim();
        if (!clientId) return err(id, 'jobber_create_quote_draft: `client_id` is required.');
        const rawItems = Array.isArray(input.line_items) ? (input.line_items as LineItemIn[]) : [];
        const lineItems = rawItems
          .map((li) => ({
            name: String(li?.name ?? '').trim(),
            description: typeof li?.description === 'string' ? li.description : undefined,
            quantity: Number(li?.quantity),
            unitPrice: Number(li?.unit_price),
          }))
          .filter((li) => li.name && Number.isFinite(li.quantity) && Number.isFinite(li.unitPrice));
        if (lineItems.length === 0) {
          return err(id, 'jobber_create_quote_draft: at least one valid line item (name, quantity, unit_price) is required.');
        }
        const quote = await createQuoteDraft({ clientId, lineItems });
        return ok(
          id,
          `Drafted quote ${quote.number ?? quote.id} (status: ${quote.status ?? 'draft'}) in Jobber. ` +
            'It still needs human review and approval/sending inside Jobber.',
        );
      }
      default:
        return err(id, `Unknown Jobber tool: ${toolUse.name}`);
    }
  } catch (e) {
    if (e instanceof JobberNotConnectedError) {
      return ok(id, NOT_CONNECTED_MSG);
    }
    return err(id, `${toolUse.name} failed: ${(e as Error).message}`);
  }
}
