# lead-research — Skills

## Tools available
- `web_search` — required. Use multiple query variants (name+company, LinkedIn URL, email domain search).

## Read access
- The prospect identifier KeyPlayer passes
- (Future: `crm_read` to check if this prospect already exists in CRM)

## Write access
- **None.** Returns structured text. KeyPlayer (or a future `crm_upsert` tool) decides whether to add to CRM.

## Out of scope
- Cold outreach drafting (that's `outreach-sender`)
- Enrichment behind paywalls / login walls
- Reaching out to the prospect (never)
- Inferring private contact info (emails, phones)
