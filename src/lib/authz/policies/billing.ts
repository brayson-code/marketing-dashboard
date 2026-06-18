// tenant — billing/plan + full-workspace operations.
//
// VA permission matrix OWNER-ONLY set: billing/plan; workspace deletion;
// full-workspace export. These are detrimental/irreversible → owner-only.
//   - manage_billing / delete / export → owner only
//   - read → any member
//
// (Cross-tenant provisioning of a NEW tenant is HQ-owner-gated at the route via
// requireHqOwner and is out of this per-tenant policy's scope.)

import { allow, deny, type Policy } from '../types';

export const tenantPolicy: Policy = (s, action, _r, _env) => {
  switch (action) {
    case 'read':
      return allow();
    case 'manage_billing':
    case 'export':
    case 'delete':
      return s.role === 'owner' ? allow() : deny('owner_only');
    default:
      return deny('unknown_action');
  }
};
