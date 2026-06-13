# Rollback runbook — Brian Rabkin build (Phases 0–3)

> Internal ops doc. Everything below shipped behind gates that default to OFF/inert,
> so the deploy itself changes nothing user-facing until you opt a tenant in. This
> runbook is the "undo" for each layer, fastest → most thorough.

## The safety model (why a panic is rarely needed)
Each risky capability is **default-off + connection-gated + (where it writes) audit-logged**.
Deploying the code does not activate anything. Activation is an explicit per-tenant choice.

## Per-feature instant disable (no redeploy)

| Feature | What it does | Instant OFF |
|---|---|---|
| **Cadence auto-send** (Phase 1) | Sends owner-APPROVED sequence steps on schedule | It's already OFF: env `CADENCE_DISPATCH_ENABLED` is unset (≠'true') → global no-op. Per-tenant also needs `business_profile.cadence_enabled=true`. To kill after enabling: set `CADENCE_DISPATCH_ENABLED=false` in Vercel, or per tenant `cadence_enabled=false`. |
| **Telegram routing** (Phase 2) | Mirrors notifications to a tenant's Telegram bot | Disconnect Telegram in Connections (no secret → total no-op), or `business_profile.telegram_notify=false` to keep the connection but mute. |
| **Google Workspace agent actions** (Phase 3) | Agents create/edit Docs/Sheets/Drive | Already OFF: `business_profile.google_actions_enabled` defaults false → tools never offered to the model. To kill after enabling: toggle it off in Settings, or disconnect Google Workspace in Connections. |
| **Data export** (Phase 0) | Owner downloads a ZIP of their data | Read-only; nothing to disable. |
| **CRM contact history + overdue badges** (Phase 1) | Read-only display | Nothing to disable. |
| **SMS lane in Engagement** (Phase 2) | Read-only display of inbound SMS/iMessage | Nothing to disable. |

SQL to flip a per-tenant flag (replace `<tenant>`):
```sql
UPDATE public.tenants
SET business_profile = business_profile || '{"cadence_enabled":false}'::jsonb
WHERE id = '<tenant>';
-- same shape for "telegram_notify":false / "google_actions_enabled":false
```

## Code rollback (revert a phase)
Each phase is one commit on `feat/command-center` (newest → oldest):
- `d1e1427` Phase 3 (Google Workspace actions + MCP design)
- `cadbcf8` Phase 2 (Telegram + SMS inbox lane)
- `0fc80d7` Phase 1 (cadence + CRM history)
- `eb782a1` Phase 0 (data export)
Revert one: `git revert <sha>` (they're mostly independent; Phase 3 touches subagent.ts,
Phase 2 + 3 both touch integrations registries — revert newest-first if reverting several),
then `vercel deploy --prod --yes`.

## Full deploy rollback (fastest "site is wrong")
Roll the production alias back to the last-good deployment without rebuilding:
`vercel rollback` (or `vercel promote <previous-deployment-url>`), or via the Vercel
dashboard → Deployments → previous READY prod deploy → Promote. The deployment right
before this batch is the commit `5fdcfd0` (token caps).

## External state changed out-of-band (for the record)
- Nango `google` integration: scopes set to Drive+Docs+Sheets (was empty). To undo:
  PATCH the integration scopes back to empty.
- Vercel prod env added: `NANGO_GOOGLE_WORKSPACE_CONFIG_KEY=google`. Remove to disable
  the Workspace connection mapping.
- No DB migrations were run for any phase (all per-tenant config lives in
  `business_profile` jsonb; the cadence cron uses existing tables).
