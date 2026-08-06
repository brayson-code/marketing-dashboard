'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  LifeBuoy, Loader2, Clock, CalendarDays, Plane, HeartPulse, ShieldAlert,
  CalendarPlus, UserPlus, Megaphone, GraduationCap, MapPin, ExternalLink, Info, Mail,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';
import { LeavePanel } from '@/components/portal/leave-panel';
import {
  accrualStatus, upcomingHolidays, ENTITLEMENTS, PROBATION_RULE, WORKING_HOURS_NOTE,
  HOLIDAY_YEAR, type LeaveKind, type HolidayRegion,
} from '@/lib/service-policy';

// Your KeyPlayers — the one surface about the SERVICE rather than the client's own
// business. Who your assistant is, when they work, what leave they have, how to get
// help, how to ask for more people, and what's coming up.
//
// Read-only for the client on purpose: start dates and leave are contractual, so HQ
// writes them and this page reads. Everything time-dependent is computed from the
// start date rather than typed, so it can't drift out of date.

interface Profile {
  ea_name: string | null; ea_role: string | null; ea_started_on: string | null;
  ea_timezone: string | null; ea_hours_start: string; ea_hours_end: string;
  ea_days: string[]; holiday_region: HolidayRegion;
  success_contact_name: string | null; success_contact_email: string | null;
  plan_name: string | null; notes: string | null;
}
interface Announcement {
  id: string; kind: 'announcement' | 'event' | 'training'; title: string; body: string;
  starts_at: string | null; location: string | null; link: string | null; pinned: boolean;
}

const LEAVE_ICON: Record<LeaveKind, typeof Plane> = {
  vacation: Plane, sick: HeartPulse, emergency: ShieldAlert,
};

const DAY_LABEL: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

// Until the GHL booking link exists this stays null and the card offers email instead
// of a dead button. A support CTA that goes nowhere is worse than no CTA.
const SUPPORT_BOOKING_URL: string | null = null;

function fmtDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export default function PortalPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  // 'va' means the ASSISTANT is reading their own placement, not the client reading
  // about their assistant. Same data, almost entirely different copy.
  const [viewer, setViewer] = useState<'client' | 'va'>('client');
  const [founderName, setFounderName] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Clock as an external store — reading Date.now() in render is impure and setting it
  // from an effect cascades. Null on the server so SSR and hydration can't disagree
  // about how many days are accrued.
  const now = useSyncExternalStore(
    (cb) => { const id = setInterval(cb, 3_600_000); return () => clearInterval(id); },
    () => Math.floor(Date.now() / 3_600_000) * 3_600_000,
    () => null,
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portal');
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setProfile(data.profile ?? null);
        setAnnouncements(data.announcements ?? []);
        setViewer(data.viewer === 'va' ? 'va' : 'client');
        setFounderName(data.founder_name ?? null);
      } catch {
        setError("Couldn't load this page. Refresh to try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const accrual = useMemo(
    () => (profile?.ea_started_on && now !== null ? accrualStatus(profile.ea_started_on, now) : null),
    [profile?.ea_started_on, now],
  );

  const holidays = useMemo(
    () => (now === null ? [] : upcomingHolidays(profile?.holiday_region ?? 'CA', now, 4)),
    [profile?.holiday_region, now],
  );

  const isVa = viewer === 'va';
  const events = announcements.filter(a => a.kind !== 'announcement');
  const notices = announcements.filter(a => a.kind === 'announcement');
  const successEmail = profile?.success_contact_email ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<LifeBuoy size={20} />}
        title="Your KeyPlayers"
        subtitle={isVa
          ? 'Your schedule, your time off, and who to talk to when you need something.'
          : 'Your assistant, their schedule, and how to get anything you need from us.'}
      />

      <Explainer
        id={isVa ? 'portal-va' : 'portal'}
        title="What this is"
        what={isVa
          ? 'Your placement in one place — your hours, the leave you have built up, and how to reach your client success contact.'
          : 'Everything about your KeyPlayers service in one place — who supports you, when they work, what time off they have, and how to reach us.'}
        when={isVa
          ? 'Before you request time off, or when you need something from KeyPlayers rather than from your client.'
          : "When you need to plan around your assistant's schedule, book support, or ask for another team member."}
        example={isVa
          ? 'Check what you have accrued before asking for a week off.'
          : "Check what's accrued before approving a week off."}
      />

      {loading ? (
        <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="panel p-6 text-sm" style={{ color: 'var(--destructive)' }}>{error}</div>
      ) : (
        <>
          {/* Your assistant */}
          <div className="panel p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {isVa ? 'You support' : 'Your assistant'}
                </p>
                <h2 className="text-lg font-semibold mt-0.5">
                  {isVa
                    ? (founderName || 'Your founder')
                    : (profile?.ea_name || 'Not set up yet')}
                </h2>
                {profile?.ea_role && <p className="text-sm text-muted-foreground">{profile.ea_role}</p>}
              </div>
              {profile?.plan_name && (
                <span className="text-[11px] px-2 py-1 rounded-lg bg-[var(--surface-2)] text-muted-foreground">
                  {profile.plan_name}
                </span>
              )}
            </div>

            {!profile?.ea_name && (
              <p className="text-xs text-muted-foreground">
                {isVa
                  ? "Your placement details haven't been filled in yet. Your client success contact can add them."
                  : "Your KeyPlayers team hasn't filled this in yet. Ask your client success contact and it'll appear here."}
              </p>
            )}

            {profile?.ea_name && (
              <div className="grid gap-3 sm:grid-cols-2 pt-1">
                <div className="flex items-start gap-2">
                  <Clock size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p>{profile.ea_hours_start}–{profile.ea_hours_end}
                      {profile.ea_timezone && (
                        <span className="text-muted-foreground"> · {profile.ea_timezone.replace(/_/g, ' ')}</span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {profile.ea_days.map(d => DAY_LABEL[d] ?? d).join(', ')}
                    </p>
                  </div>
                </div>
                {profile.ea_started_on && (
                  <div className="flex items-start gap-2">
                    <CalendarDays size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p>{isVa ? 'You started' : 'Started with you'} {fmtDate(profile.ea_started_on)}</p>
                      {accrual && (
                        <p className="text-[11px] text-muted-foreground">
                          {accrual.inProbation
                            ? `Probation ends ${fmtDate(accrual.probationEndsOn)} · ${accrual.daysToProbationEnd} days`
                            : `${accrual.monthsElapsed} months together`}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground pt-1">
              {isVa
                ? "You work in your client's timezone, usually between 9am and 5pm, weekdays. Both the hours and the days are flexible if the business needs something different."
                : WORKING_HOURS_NOTE}
            </p>
          </div>

          {/* Time off */}
          <div className="panel p-4 space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {isVa ? 'Your time off' : 'Time off'}
            </p>

            <div className="grid gap-2 sm:grid-cols-3">
              {ENTITLEMENTS.map((e) => {
                const Icon = LEAVE_ICON[e.kind];
                return (
                  <div key={e.kind} className="rounded-lg bg-[var(--surface-2)] p-3">
                    <p className="text-xs font-medium flex items-center gap-1.5">
                      <Icon size={12} className="text-[var(--primary)]" /> {e.label}
                    </p>
                    {accrual ? (
                      <>
                        <p className="text-lg font-semibold mt-1">
                          {accrual.available[e.kind]}
                          <span className="text-xs font-normal text-muted-foreground"> of {e.daysPerYear} available</span>
                        </p>
                        {accrual.inProbation && accrual.accrued[e.kind] > 0 && (
                          <p className="text-[11px]" style={{ color: 'var(--warning)' }}>
                            {accrual.accrued[e.kind]} accrued, unlocks {fmtDate(accrual.probationEndsOn)}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-lg font-semibold mt-1">
                        {e.daysPerYear}<span className="text-xs font-normal text-muted-foreground"> days a year</span>
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {isVa ? e.blurb.replace(/\btheir\b/g, 'your').replace(/\bThey can\b/g, 'You can') : e.blurb}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* The probation rule is the part clients get wrong, so it's stated in full
                rather than summarised into a number. */}
            {accrual?.inProbation && (
              <div
                className="rounded-lg p-3 text-xs space-y-1"
                style={{ background: 'color-mix(in srgb, var(--warning) 8%, transparent)' }}
              >
                <p className="font-medium flex items-center gap-1.5">
                  <Info size={12} style={{ color: 'var(--warning)' }} /> {PROBATION_RULE.summary}
                </p>
                <p className="text-muted-foreground">{PROBATION_RULE.accrues}</p>
                <p className="text-muted-foreground">{PROBATION_RULE.ifTaken}</p>
              </div>
            )}
          </div>

          {/* Requesting it, right where the balance is read. Only rendered once there
              is a placement to request against. */}
          {profile?.ea_started_on && accrual && (
            <LeavePanel
              isVa={isVa}
              workingDayNames={profile.ea_days}
              accrued={accrual.accrued}
              inProbation={accrual.inProbation}
              region={profile.holiday_region}
            />
          )}

          {/* Holidays */}
          <div className="panel p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Upcoming holidays
              </p>
              <span className="text-[11px] text-muted-foreground">
                {profile?.holiday_region === 'US' ? 'US federal' : 'Canadian statutory'}
              </span>
            </div>
            {holidays.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No more holidays in {HOLIDAY_YEAR}. Next year&apos;s calendar is added each December.
              </p>
            ) : (
              <div className="space-y-1">
                {holidays.map(h => (
                  <div key={h.date} className="flex items-center justify-between text-sm py-1">
                    <span>{h.name}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(h.date)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Get help / ask for more people */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="panel p-4 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <CalendarPlus size={14} className="text-[var(--primary)]" /> Book support
              </p>
              <p className="text-xs text-muted-foreground">
                {isVa
                  ? 'Something you need from KeyPlayers, or something about the placement you want to raise?'
                  : "Something not working, or want to talk through how you're using your assistant?"}
              </p>
              {SUPPORT_BOOKING_URL ? (
                <a
                  href={SUPPORT_BOOKING_URL} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)]"
                >
                  Book a time <ExternalLink size={11} />
                </a>
              ) : successEmail ? (
                <a
                  href={`mailto:${successEmail}?subject=${encodeURIComponent('Support request')}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)]"
                >
                  <Mail size={11} /> Email {profile?.success_contact_name ?? 'client success'}
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Your client success contact will be listed here shortly.
                </p>
              )}
            </div>

            {/* Asking for more people is the CLIENT's decision, not the assistant's. */}
            {!isVa && (
            <div className="panel p-4 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <UserPlus size={14} className="text-[var(--primary)]" /> Need another person?
              </p>
              <p className="text-xs text-muted-foreground">
                Another assistant, or someone for a different role — sales support, bookkeeping,
                recruiting. Tell us the role and we&apos;ll come back with candidates.
              </p>
              {successEmail ? (
                <a
                  href={`mailto:${successEmail}?subject=${encodeURIComponent('Request: additional team member')}&body=${encodeURIComponent('The role we need:\n\nWhat they would own:\n\nHours per week:\n\nWhen we need them:\n')}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)]"
                >
                  <Mail size={11} /> Request someone
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Your client success contact will be listed here shortly.
                </p>
              )}
            </div>
            )}
          </div>

          {/* Events + announcements */}
          {events.length > 0 && (
            <div className="panel p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Events and training
              </p>
              {events.map(e => (
                <div key={e.id} className="py-1.5 border-b border-border/30 last:border-0">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <GraduationCap size={13} className="text-[var(--primary)] shrink-0" />
                    {e.title}
                  </p>
                  {e.body && <p className="text-xs text-muted-foreground mt-0.5">{e.body}</p>}
                  <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                    {e.starts_at && (
                      <span>{new Date(e.starts_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })}</span>
                    )}
                    {e.location && <span className="flex items-center gap-1"><MapPin size={10} />{e.location}</span>}
                    {e.link && (
                      <a href={e.link} target="_blank" rel="noopener noreferrer"
                         className="text-[var(--primary)] inline-flex items-center gap-1">
                        Details <ExternalLink size={10} />
                      </a>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}

          {notices.length > 0 && (
            <div className="panel p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                From KeyPlayers
              </p>
              {notices.map(a => (
                <div key={a.id} className="py-1.5 border-b border-border/30 last:border-0">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Megaphone size={13} className="text-[var(--primary)] shrink-0" />
                    {a.title}
                  </p>
                  {a.body && <p className="text-xs text-muted-foreground mt-0.5">{a.body}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
