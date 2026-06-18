// ABAC type model — ADR-001 §4.1. Four plain-object attribute bags + a Decision
// value type. No classes, no inheritance. Decisions are VALUES (not exceptions) so
// policies are pure functions, trivially unit-testable with no mocks.
//
// SAFETY: nothing in this module (or anywhere under src/lib/authz) issues a query
// or removes a `WHERE tenant_id = ${tenantId()}` filter. authorize() can ONLY ever
// DENY — it composes monotonically (AND) with tenant isolation + RLS and can never
// grant cross-tenant access. See ADR §7.

export type WorkspaceRole = 'owner' | 'member' | 'va';

export interface Subject {
  userId: string;
  tenantId: string;
  role: WorkspaceRole;
  isHq: boolean;
  attrs: Record<string, unknown>;
}

export interface Resource<T extends string = string> {
  type: T;
  tenantId: string;
  createdBy?: string | null;
  attrs: Record<string, unknown>;
}

export interface Env {
  now: Date;
  via: 'api' | 'cron' | 'webhook';
  ip?: string;
  requestId?: string;
}

export type Decision = { allow: true } | { allow: false; reason: string };

export const allow = (): Decision => ({ allow: true });
export const deny = (reason: string): Decision => ({ allow: false, reason });

// The resource-type discriminants. Add a member here AND register a policy in
// policies/index.ts — an unpoliced known type denies once enforcement is on
// (default-DENY for known-unknowns; ADR §4.1 check 3).
export type ResourceType =
  | 'client_integration'
  | 'draft'
  | 'agent_def'
  | 'cron'
  | 'campaign'
  | 'connection'
  | 'tenant'
  | 'workspace_member'
  | 'autonomy'
  | 'hq_surface';

// The verb union — already implied by HTTP method + route. Policies switch on these.
export type Action =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'publish'
  | 'send'
  | 'spawn'
  | 'rotate_secret'
  | 'disconnect'
  | 'invite'
  | 'change_role'
  | 'remove_member'
  | 'export'
  | 'manage_billing'
  | 'manage_system'
  | 'open_pr'
  | 'run_fixer';

// A policy is a pure function: (subject, action, resource, env) -> Decision.
export type Policy = (s: Subject, action: string, r: Resource, env: Env) => Decision;

// AUTHZ_ENFORCE migration flag. Read at RUNTIME so rollback is one env var, no deploy.
//  - 'off'    (DEFAULT): authorize() short-circuits to allow() — identical to today.
//  - 'shadow': denials are computed + LOGGED by the handler helper, but ALLOWED.
//  - 'on'     : denials return 403.
export type AuthzMode = 'off' | 'shadow' | 'on';

export function authzMode(): AuthzMode {
  const raw = process.env.AUTHZ_ENFORCE ?? 'off';
  // Treat the prompt's binary AUTHZ_ENFORCE='true' as the strict 'on' mode, and any
  // unrecognized value as 'off' (fail-safe to "behaves exactly as today").
  if (raw === 'on' || raw === 'true') return 'on';
  if (raw === 'shadow') return 'shadow';
  return 'off';
}
