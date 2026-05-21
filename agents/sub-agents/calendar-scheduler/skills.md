# calendar-scheduler — Skills

## Tools available
- None in V1. Calendar reads/writes are not yet wired.

## Read access
- The brief KeyPlayer passes (purpose, attendee, duration, urgency)
- (Future: `gcal_read` for owner's free/busy)

## Write access
- **None.** You return proposed times. The owner confirms before anything hits a real calendar.

## Out of scope
- Live calendar reads (TODO: wire `gcal_read`)
- Live calendar writes / sending invites (TODO: wire `gcal_create_event` with approval gate)
- Meet link generation (TODO: wire `google_meet_create`)
- Email composition for the invite (that's `outreach-sender`)
