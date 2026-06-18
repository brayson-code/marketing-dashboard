// workspace_member — team/member management.
//
// VA permission matrix OWNER-ONLY set ("detrimental/irreversible"): member
// management — invite, remove_member, change_role — is owner-only. The VA (and a
// plain member) cannot add, remove, or re-role teammates.
//
// Last-owner protection lives in the ROUTE (it needs a count query and a clear 409
// message), not in this pure, query-free policy (ADR §1a / §4 note).

import { allow, deny, type Policy } from '../types';

export const memberPolicy: Policy = (s, action, _r, _env) => {
  switch (action) {
    case 'read':
      return allow();
    case 'invite':
    case 'change_role':
    case 'remove_member':
      return s.role === 'owner' ? allow() : deny('member_management_requires_owner');
    default:
      return deny('unknown_action');
  }
};
