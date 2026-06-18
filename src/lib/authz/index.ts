// ABAC public surface (ADR-001). Import from '@/lib/authz'.
//
//   import { requireAuthorized, getSubject, authorize } from '@/lib/authz';
//
// SAFETY INVARIANT: nothing here issues a tenant query or removes a
// `WHERE tenant_id = ${tenantId()}` filter. authorize() can ONLY ever DENY — it
// composes monotonically with tenant isolation + RLS. Default flag (AUTHZ_ENFORCE
// unset/off) → behaves exactly as today.

export * from './types';
export { authorize } from './authorize';
export {
  getSubject,
  peekSubject,
  primeSubject,
  isActiveMember,
  ROLE_TO_RBAC,
  type ResolvedSubject,
} from './subject';
export { requireAuthorized, requireRole, withAuthz } from './guard';
export { policies, HQ_ONLY_TYPES } from './policies';
// Hard role gates for the audit's named OWNER-ONLY / sensitive routes (real 403,
// independent of AUTHZ_ENFORCE; single-owner prod unaffected).
export {
  getMemberRole,
  isTenantOwner,
  requireOwner,
  requireOwnerOrMember,
} from './owner-gate';
