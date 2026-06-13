// Google Calendar integration via Nango — rides the SAME 'google-workspace'
// connection as Drive/Docs/Sheets/Gmail (one "Connect Google" grant carries the
// calendar scope). We do NOT duplicate connection logic: getConn() + gwProxy()
// come from google-workspace.ts so all of Google shares one connection + proxy.
//
// Nango handles the OAuth token + refresh — we never see the access token, and
// nothing here logs tokens. Failures bubble up as tagged Errors
// ('google-calendar: <cause>'). Fail closed: when the tenant isn't connected,
// gwProxy throws a tagged error instead of acting.
//
// Calendar lives at https://www.googleapis.com/calendar/v3 — every call passes
// that FULL endpoint URL to the Nango proxy (the proxy routes by host).

import { gwProxy, isWorkspaceConnected } from './google-workspace';

const TAG = 'google-calendar';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
// The authenticated user's default calendar.
const PRIMARY = 'primary';

/** True if this tenant has a connected Google account — cheap check, no API call.
 *  Calendar rides the same connection as the rest of Google. */
export async function isCalendarConnected(): Promise<boolean> {
  return isWorkspaceConnected();
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  /** Event start — ISO datetime (timed events) or YYYY-MM-DD (all-day). */
  start: string;
  /** Event end — ISO datetime (timed events) or YYYY-MM-DD (all-day). */
  end: string;
  location: string;
  attendees: string[];
  htmlLink: string;
}

interface RawEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string }>;
}

/** Normalise a Calendar API event to a flat shape; start/end collapse the
 *  dateTime-vs-date (all-day) distinction to a single string. */
function toEvent(e: RawEvent): CalendarEvent {
  return {
    id: e.id ?? '',
    summary: e.summary ?? '',
    description: e.description ?? '',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    location: e.location ?? '',
    attendees: (e.attendees ?? []).map((a) => a.email ?? '').filter(Boolean),
    htmlLink: e.htmlLink ?? '',
  };
}

/**
 * Upcoming events on the tenant's primary calendar, soonest first. Uses
 * events.list with timeMin=now, singleEvents (so recurring events expand to
 * individual instances) and orderBy=startTime.
 */
export async function listUpcomingEvents(limit = 10): Promise<CalendarEvent[]> {
  const max = Math.max(1, Math.min(limit, 50));
  interface ListResp { items?: RawEvent[] }
  const r = await gwProxy<ListResp>(
    {
      endpoint: `${CAL_BASE}/calendars/${PRIMARY}/events`,
      params: {
        timeMin: new Date().toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: max,
      },
    },
    TAG,
  );
  return (r.items ?? []).map(toEvent);
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface CreateEventInput {
  summary: string;
  description?: string;
  /** ISO datetime for a timed event (e.g. '2026-06-15T14:00:00-07:00'). */
  start: string;
  /** ISO datetime for a timed event. */
  end: string;
  /** Attendee email addresses to invite (optional). */
  attendees?: string[];
}

/** Create an event on the tenant's primary calendar via events.insert. Returns
 *  the normalised created event (with its id + htmlLink). */
export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
  const summary = String(input?.summary ?? '').trim();
  const start = String(input?.start ?? '').trim();
  const end = String(input?.end ?? '').trim();
  if (!summary) throw new Error(`${TAG}: "summary" is required`);
  if (!start) throw new Error(`${TAG}: "start" is required`);
  if (!end) throw new Error(`${TAG}: "end" is required`);

  const body: {
    summary: string;
    description?: string;
    start: { dateTime: string };
    end: { dateTime: string };
    attendees?: Array<{ email: string }>;
  } = {
    summary,
    start: { dateTime: start },
    end: { dateTime: end },
  };
  if (input.description) body.description = String(input.description);
  const attendees = (input.attendees ?? [])
    .map((a) => String(a ?? '').trim())
    .filter(Boolean);
  if (attendees.length) body.attendees = attendees.map((email) => ({ email }));

  const r = await gwProxy<RawEvent>(
    {
      method: 'POST',
      endpoint: `${CAL_BASE}/calendars/${PRIMARY}/events`,
      data: body,
    },
    TAG,
  );
  if (!r?.id) throw new Error(`${TAG}: events.insert returned no event id`);
  return toEvent(r);
}
