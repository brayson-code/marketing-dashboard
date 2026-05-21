# outreach-sender — Skills

## Tools available
- None directly. If recipient context is missing, return blocked. KeyPlayer can spawn `lead-research` first to enrich.

## Read access
- Recipient details and reason for outreach passed in by KeyPlayer
- (Future: `gmail_read` for prior thread context with the same recipient)

## Write access
- **None directly.** Returns drafts. KeyPlayer (or a future email-publish tool) handles `status=draft` storage.

## Hard prohibitions
- ❌ Cannot send email (no smtp/gmail send tool — by design)
- ❌ Cannot mark a sequence as `started` or `active`
- ❌ Cannot enroll a recipient in an outreach campaign

## Out of scope
- Lead enrichment (that's `lead-research`)
- Web research (that's `research-analyst`)
- Calendar invites (that's `calendar-scheduler`)
