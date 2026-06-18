// Policy registry — one entry per ResourceType (ADR §4). A registered policy is a
// pure function (subject, action, resource, env) -> Decision. The dispatcher
// (authorize.ts) looks the policy up by resource.type; a known type WITHOUT a policy
// denies once enforcement is on (default-DENY for known-unknowns, ADR §4.1 check 3).
//
// EVERY policy is default-ALLOW-for-owner unless a specific deny fires — so
// single-owner tenants (100% of production today) are unaffected the instant
// enforcement flips. The VA matrix grants members/VAs their broad operational surface
// and reserves only the detrimental/irreversible actions for the owner.

import type { Policy, ResourceType } from '../types';
import { clientIntegrationPolicy } from './client-integrations';
import { draftPolicy } from './drafts';
import { agentDefPolicy } from './agent-defs';
import { cronPolicy } from './cron';
import { autonomyPolicy } from './autonomy';
import { memberPolicy } from './members';
import { tenantPolicy } from './billing';
import { hqSurfacePolicy } from './hq';

// Resource types that are HQ-only — checked in the dispatcher (deny 'hq_only')
// BEFORE the per-type policy runs. Folds requireHq() in with identical semantics.
export const HQ_ONLY_TYPES = new Set<ResourceType>(['hq_surface']);

export const policies: Partial<Record<ResourceType, Policy>> = {
  client_integration: clientIntegrationPolicy,
  // A connection IS a client integration (the disconnect/rotate surface) — same policy.
  connection: clientIntegrationPolicy,
  draft: draftPolicy,
  // Campaigns are operational content the VA runs on the owner's behalf — draft-shaped.
  campaign: draftPolicy,
  agent_def: agentDefPolicy,
  cron: cronPolicy,
  autonomy: autonomyPolicy,
  workspace_member: memberPolicy,
  tenant: tenantPolicy,
  hq_surface: hqSurfacePolicy,
};
