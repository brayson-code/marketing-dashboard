// authorize() — the dispatcher (ADR §4.1). Synchronous, in-process, issues ZERO
// queries. Mandatory deny-only pre-checks run first (they can never grant), then the
// per-resource-type policy. Composes monotonically (AND) with tenant isolation + RLS:
// turning it on can only convert 200s -> 403s, never the reverse.
//
// The flag is read at RUNTIME so rollback is one env var, no deploy:
//   - 'off' (default): returns allow() immediately — IDENTICAL to today.
//   - 'shadow'/'on'  : the dispatcher computes the real decision (returns the deny).
//     The HANDLER HELPER (guard.ts) converts a shadow-deny into a logged-allow, so
//     'on' and 'shadow' share ONE decision path here.

import {
  allow,
  deny,
  authzMode,
  type Subject,
  type Resource,
  type ResourceType,
  type Env,
  type Decision,
} from './types';
import { policies, HQ_ONLY_TYPES } from './policies';

export function authorize(s: Subject, action: string, r: Resource, env: Env): Decision {
  // Default-off behaves exactly as today.
  if (authzMode() === 'off') return allow();

  // (1) HARD pre-check — can ONLY deny; REINFORCES (never replaces) tenant isolation.
  //     The row was already loaded under tenantId() scoping, so this is belt-and-braces.
  if (r.tenantId !== s.tenantId) return deny('cross_tenant');

  // r.type is a free `string` on the generic Resource; narrow it to the registry key.
  const type = r.type as ResourceType;

  // (2) HQ surfaces — folds in requireHq() with identical semantics.
  if (HQ_ONLY_TYPES.has(type) && !s.isHq) return deny('hq_only');

  // (3) Resource-type policy (default-DENY for any unpoliced known type).
  const policy = policies[type];
  if (!policy) return deny('no_policy');
  return policy(s, action, r, env);
}
