// Google Meet integration via Nango — rides the SAME 'google-workspace'
// connection as Drive/Docs/Sheets/Gmail/Calendar (one "Connect Google" grant
// carries the meetings.space.created + meetings.space.readonly scopes).
// We do NOT duplicate connection logic: gwProxy() + isWorkspaceConnected()
// come from google-workspace.ts so all of Google shares one connection + proxy.
//
// Nango handles the OAuth token + refresh — we never see the access token, and
// nothing here logs tokens. Failures bubble up as tagged Errors
// ('google-meet: <cause>'). Fail closed: when the tenant isn't connected,
// gwProxy throws a tagged error instead of acting.
//
// Meet lives at https://meet.googleapis.com/v2 — every call passes a FULL
// endpoint URL to the Nango proxy (the proxy routes by host).

import { gwProxy, isWorkspaceConnected } from './google-workspace';

const TAG = 'google-meet';
const MEET_BASE = 'https://meet.googleapis.com/v2';

/** True if this tenant has a connected Google account — cheap check, no API call.
 *  Meet rides the same connection as the rest of Google. */
export async function isMeetConnected(): Promise<boolean> {
  return isWorkspaceConnected();
}

// ── Create space ──────────────────────────────────────────────────────────────

export interface MeetSpace {
  /** The resource name returned by the API, e.g. 'spaces/abc123'. */
  space_id: string;
  /** The https://meet.google.com/xxx join URL. */
  meeting_uri: string;
  /** Short human-readable meeting code (e.g. 'abc-defg-hij'). */
  meeting_code: string;
}

interface RawSpace {
  name?: string;
  meetingUri?: string;
  meetingCode?: string;
}

/**
 * Create a new Google Meet meeting space via spaces.create (POST /v2/spaces).
 * The body must be empty — the API rejects any payload in the request body.
 * Returns the space resource name, the join URL, and the meeting code.
 *
 * This is the high-value action: an agent can spin up a Meet link on demand
 * and drop it straight into a calendar invite body or an email.
 */
export async function createMeetingSpace(): Promise<MeetSpace> {
  const r = await gwProxy<RawSpace>(
    {
      method: 'POST',
      endpoint: `${MEET_BASE}/spaces`,
      data: {},
    },
    TAG,
  );
  // Guard every field — the API shape may vary depending on configured scopes.
  const space_id = r?.name ?? '';
  const meeting_uri = r?.meetingUri ?? '';
  const meeting_code = r?.meetingCode ?? '';
  if (!space_id) throw new Error(`${TAG}: spaces.create returned no space name`);
  if (!meeting_uri) throw new Error(`${TAG}: spaces.create returned no meetingUri`);
  return { space_id, meeting_uri, meeting_code };
}

// ── Conference records ────────────────────────────────────────────────────────

export interface ConferenceRecord {
  /** Resource name, e.g. 'conferenceRecords/abc123'. */
  conference_id: string;
  /** The space this recording belongs to (e.g. 'spaces/abc'). */
  space: string;
  start_time: string;
  end_time: string;
}

interface RawConferenceRecord {
  name?: string;
  space?: string;
  startTime?: string;
  endTime?: string;
}

interface ConferenceRecordListResp {
  conferenceRecords?: RawConferenceRecord[];
  nextPageToken?: string;
}

/** Normalise a raw conferenceRecord to our flat shape. */
function toRecord(r: RawConferenceRecord): ConferenceRecord {
  return {
    conference_id: r.name ?? '',
    space: r.space ?? '',
    start_time: r.startTime ?? '',
    end_time: r.endTime ?? '',
  };
}

/**
 * The most-recent Meet conference records for this user, newest first.
 * Uses conferenceRecords.list with pageSize capped at limit (default 5).
 * The Meet API returns records in reverse-chronological order by default.
 */
export async function listRecentConferences(limit = 5): Promise<ConferenceRecord[]> {
  const pageSize = Math.max(1, Math.min(limit, 100));
  const r = await gwProxy<ConferenceRecordListResp>(
    {
      endpoint: `${MEET_BASE}/conferenceRecords`,
      params: { pageSize },
    },
    TAG,
  );
  return (r?.conferenceRecords ?? [])
    .filter((rec): rec is RawConferenceRecord => !!rec.name)
    .map(toRecord);
}

// ── Transcripts ───────────────────────────────────────────────────────────────

export interface TranscriptResult {
  conference_id: string;
  text: string;
}

interface RawTranscript {
  name?: string;
  state?: string;
}

interface TranscriptListResp {
  transcripts?: RawTranscript[];
}

interface RawTranscriptEntry {
  name?: string;
  text?: string;
  participant?: { signedinUser?: { displayName?: string }; anonymousUser?: { displayName?: string } };
  startTime?: string;
}

interface TranscriptEntryListResp {
  entries?: RawTranscriptEntry[];
  nextPageToken?: string;
}

/** Pull the display name out of a transcript entry's participant field, defensive. */
function entryParticipant(e: RawTranscriptEntry): string {
  const p = e.participant;
  if (!p) return '';
  return (
    p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? ''
  );
}

/**
 * Fetch the transcript of the most recent Meet conference that has one.
 *
 * Approach:
 *   1. List conferenceRecords (newest first).
 *   2. For the first record, list its transcripts.
 *   3. For the first transcript, page through /entries (cap ~200).
 *   4. Join entry texts (with speaker name when present) into a single string.
 *
 * Returns null if no conferenceRecord exists or no transcript is available
 * (e.g. transcription wasn't enabled, or the call just ended and processing
 * is still pending).
 *
 * READ-ONLY — requires meetings.space.readonly scope only.
 */
export async function getLatestTranscriptText(): Promise<TranscriptResult | null> {
  // Step 1 — find the most recent conference.
  let records: ConferenceRecord[];
  try {
    records = await listRecentConferences(5);
  } catch {
    // No records reachable — fail closed with null rather than throwing so the
    // agent gets a 'no transcript found' message instead of a hard error.
    return null;
  }
  if (records.length === 0) return null;

  const conferenceId = records[0].conference_id;

  // Step 2 — list transcripts for that conference.
  let transcriptName: string | null = null;
  try {
    const tResp = await gwProxy<TranscriptListResp>(
      {
        endpoint: `${MEET_BASE}/${conferenceId}/transcripts`,
        params: { pageSize: 10 },
      },
      TAG,
    );
    const transcripts = tResp?.transcripts ?? [];
    // Guard: the API only returns completed transcripts; state may be 'ENDED'.
    // Accept the first entry regardless of state — some API versions omit state.
    const first = transcripts[0];
    if (!first?.name) return null;
    transcriptName = first.name;
  } catch {
    return null;
  }

  // Step 3 — page through entries (cap 200 total to keep context manageable).
  const parts: string[] = [];
  let pageToken: string | undefined;
  const ENTRY_PAGE_SIZE = 100;
  const MAX_ENTRIES = 200;
  let fetched = 0;

  try {
    do {
      const params: Record<string, string | number> = { pageSize: ENTRY_PAGE_SIZE };
      if (pageToken) params.pageToken = pageToken;

      const eResp = await gwProxy<TranscriptEntryListResp>(
        {
          endpoint: `${MEET_BASE}/${transcriptName}/entries`,
          params,
        },
        TAG,
      );

      const entries = eResp?.entries ?? [];
      for (const entry of entries) {
        const text = entry.text ?? '';
        if (!text) continue;
        const speaker = entryParticipant(entry);
        parts.push(speaker ? `${speaker}: ${text}` : text);
        fetched++;
        if (fetched >= MAX_ENTRIES) break;
      }

      pageToken = fetched < MAX_ENTRIES ? (eResp?.nextPageToken ?? undefined) : undefined;
    } while (pageToken);
  } catch {
    // Partial transcript is still useful — fall through and return what we have.
  }

  if (parts.length === 0) return null;

  return {
    conference_id: conferenceId,
    text: parts.join('\n'),
  };
}
