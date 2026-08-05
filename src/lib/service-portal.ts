// Service Portal reads/writes. SERVER ONLY — imports the db client, so never
// value-import this from a client component (that drags the Postgres driver into the
// browser bundle, and tsc will not catch it). The pure half is service-policy.ts.

import { sql } from './db/client';
import { tenantId } from './tenant';
import type { HolidayRegion } from './service-policy';

export interface ServiceProfile {
  tenant_id: string;
  ea_name: string | null;
  ea_role: string | null;
  ea_started_on: string | null;
  ea_timezone: string | null;
  ea_hours_start: string;
  ea_hours_end: string;
  ea_days: string[];
  holiday_region: HolidayRegion;
  success_contact_name: string | null;
  success_contact_email: string | null;
  plan_name: string | null;
  notes: string | null;
  updated_at: string | null;
}

export type AnnouncementKind = 'announcement' | 'event' | 'training';
export type Audience = 'client' | 'va' | 'all';

export interface Announcement {
  id: string;
  kind: AnnouncementKind;
  audience: Audience;
  title: string;
  body: string;
  starts_at: string | null;
  location: string | null;
  link: string | null;
  pinned: boolean;
  published_at: string;
  expires_at: string | null;
  created_by: string | null;
}

function toDateStr(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return new Date(v as string).toISOString().slice(0, 10);
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : new Date(v as string).toISOString();
}

/** The active workspace's service profile, or null if HQ hasn't filled one in yet. */
export async function getServiceProfile(target?: string): Promise<ServiceProfile | null> {
  const tid = target ?? tenantId();
  const rows = (await sql()`
    SELECT * FROM public.service_profiles WHERE tenant_id = ${tid}
  `) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  return {
    tenant_id: String(r.tenant_id),
    ea_name: (r.ea_name as string) ?? null,
    ea_role: (r.ea_role as string) ?? null,
    ea_started_on: toDateStr(r.ea_started_on),
    ea_timezone: (r.ea_timezone as string) ?? null,
    ea_hours_start: (r.ea_hours_start as string) ?? '09:00',
    ea_hours_end: (r.ea_hours_end as string) ?? '17:00',
    ea_days: (r.ea_days as string[]) ?? [],
    holiday_region: (r.holiday_region === 'US' ? 'US' : 'CA'),
    success_contact_name: (r.success_contact_name as string) ?? null,
    success_contact_email: (r.success_contact_email as string) ?? null,
    plan_name: (r.plan_name as string) ?? null,
    notes: (r.notes as string) ?? null,
    updated_at: toIso(r.updated_at),
  };
}

/**
 * The feed a client sees: everything for 'client' or 'all', not expired, pinned first.
 *
 * Events that have already happened are excluded — a stale "upcoming training" is worse
 * than an empty section, because it makes the whole page look unmaintained.
 */
export async function listAnnouncements(audience: Audience = 'client'): Promise<Announcement[]> {
  const rows = (await sql()`
    SELECT * FROM public.service_announcements
    WHERE (audience = ${audience} OR audience = 'all')
      AND (expires_at IS NULL OR expires_at > now())
      AND (starts_at IS NULL OR starts_at > now() - interval '1 day')
    ORDER BY pinned DESC, COALESCE(starts_at, published_at) ASC
    LIMIT 50
  `) as unknown as Array<Record<string, unknown>>;

  return rows.map(r => ({
    id: String(r.id),
    kind: (r.kind as AnnouncementKind) ?? 'announcement',
    audience: (r.audience as Audience) ?? 'client',
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    starts_at: toIso(r.starts_at),
    location: (r.location as string) ?? null,
    link: (r.link as string) ?? null,
    pinned: !!r.pinned,
    published_at: toIso(r.published_at) ?? new Date(0).toISOString(),
    expires_at: toIso(r.expires_at),
    created_by: (r.created_by as string) ?? null,
  }));
}

// ── HQ writes ───────────────────────────────────────────────────────────────
// Callers MUST be requireHq()-gated. A client can read their profile but must never
// write it — leave dates and probation are contractual, not self-service.

const DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

export interface ServiceProfileInput {
  ea_name?: string | null;
  ea_role?: string | null;
  ea_started_on?: string | null;
  ea_timezone?: string | null;
  ea_hours_start?: string;
  ea_hours_end?: string;
  ea_days?: string[];
  holiday_region?: string;
  success_contact_name?: string | null;
  success_contact_email?: string | null;
  plan_name?: string | null;
  notes?: string | null;
}

export async function upsertServiceProfile(target: string, input: ServiceProfileInput): Promise<void> {
  const days = (input.ea_days ?? ['mon', 'tue', 'wed', 'thu', 'fri'])
    .map(d => String(d).toLowerCase().slice(0, 3))
    .filter(d => DAYS.has(d));
  const region = input.holiday_region === 'US' ? 'US' : 'CA';
  // An invalid date would poison every accrual figure on the page, so it's dropped
  // rather than stored — better a blank than a wrong probation end date. Typed as
  // `string | null` explicitly: postgres.js rejects `undefined` as a parameter.
  const raw = String(input.ea_started_on ?? '');
  const started: string | null = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

  await sql()`
    INSERT INTO public.service_profiles (
      tenant_id, ea_name, ea_role, ea_started_on, ea_timezone,
      ea_hours_start, ea_hours_end, ea_days, holiday_region,
      success_contact_name, success_contact_email, plan_name, notes, updated_at
    ) VALUES (
      ${target}, ${input.ea_name ?? null}, ${input.ea_role ?? null}, ${started}, ${input.ea_timezone ?? null},
      ${input.ea_hours_start ?? '09:00'}, ${input.ea_hours_end ?? '17:00'}, ${days}, ${region},
      ${input.success_contact_name ?? null}, ${input.success_contact_email ?? null},
      ${input.plan_name ?? null}, ${input.notes ?? null}, now()
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      ea_name = EXCLUDED.ea_name, ea_role = EXCLUDED.ea_role,
      ea_started_on = EXCLUDED.ea_started_on, ea_timezone = EXCLUDED.ea_timezone,
      ea_hours_start = EXCLUDED.ea_hours_start, ea_hours_end = EXCLUDED.ea_hours_end,
      ea_days = EXCLUDED.ea_days, holiday_region = EXCLUDED.holiday_region,
      success_contact_name = EXCLUDED.success_contact_name,
      success_contact_email = EXCLUDED.success_contact_email,
      plan_name = EXCLUDED.plan_name, notes = EXCLUDED.notes, updated_at = now()
  `;
}

export interface AnnouncementInput {
  kind?: string;
  audience?: string;
  title: string;
  body?: string;
  starts_at?: string | null;
  location?: string | null;
  link?: string | null;
  pinned?: boolean;
  expires_at?: string | null;
  created_by?: string | null;
}

const KINDS = new Set(['announcement', 'event', 'training']);
const AUDIENCES = new Set(['client', 'va', 'all']);

export async function createAnnouncement(input: AnnouncementInput): Promise<string | null> {
  const title = String(input.title ?? '').trim();
  if (!title) return null;
  // Explicit `string` (not `string | undefined`) — postgres.js rejects undefined params.
  const kind: string = KINDS.has(String(input.kind)) ? String(input.kind) : 'announcement';
  const audience: string = AUDIENCES.has(String(input.audience)) ? String(input.audience) : 'client';

  const rows = (await sql()`
    INSERT INTO public.service_announcements
      (kind, audience, title, body, starts_at, location, link, pinned, expires_at, created_by)
    VALUES (
      ${kind}, ${audience}, ${title}, ${input.body ?? ''},
      ${input.starts_at || null}, ${input.location ?? null}, ${input.link ?? null},
      ${!!input.pinned}, ${input.expires_at || null}, ${input.created_by ?? null}
    )
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await sql()`DELETE FROM public.service_announcements WHERE id = ${id}`;
}

/** Every announcement, including expired — HQ needs to see what it published. */
export async function listAllAnnouncements(): Promise<Announcement[]> {
  const rows = (await sql()`
    SELECT * FROM public.service_announcements
    ORDER BY pinned DESC, published_at DESC LIMIT 200
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: String(r.id),
    kind: (r.kind as AnnouncementKind) ?? 'announcement',
    audience: (r.audience as Audience) ?? 'client',
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    starts_at: toIso(r.starts_at),
    location: (r.location as string) ?? null,
    link: (r.link as string) ?? null,
    pinned: !!r.pinned,
    published_at: toIso(r.published_at) ?? new Date(0).toISOString(),
    expires_at: toIso(r.expires_at),
    created_by: (r.created_by as string) ?? null,
  }));
}
