// client_integrations — carries secret_encrypted. SPECIAL step-up case (prompt /
// ADR §4.2 corrected to the pending-approval model).
//
// VA permission matrix: key/secret rotation is the ONE thing the VA may NOT do
// directly — it requires OWNER step-up confirmation. So:
//   - read                  → any member (owner/member/va)
//   - rotate_secret/disconnect → owner (or an explicit billing_admin attr) ONLY;
//        VA/member are DENIED here. The ROUTE turns a VA/member attempt into a
//        pending_approvals row (Engineer B) instead of executing; the policy still
//        returns deny so shadow logging is accurate.
//   - create/update carrying a secret → owner-only; non-secret config → owner/member/va.

import { allow, deny, type Policy } from '../types';

export const clientIntegrationPolicy: Policy = (s, action, r, _env) => {
  const carriesSecret = r.attrs.secret_encrypted != null || r.attrs.secret != null;
  switch (action) {
    case 'read':
      return allow();
    case 'rotate_secret':
    case 'disconnect':
      if (s.role === 'owner' || s.attrs.billing_admin === true) return allow();
      // VA/member: NOT a direct allow. Route creates a pending_approvals row.
      return deny('secret_change_requires_owner');
    case 'create':
    case 'update':
      // A write that carries a secret is a rotation in disguise → owner-only.
      if (carriesSecret && !(s.role === 'owner' || s.attrs.billing_admin === true)) {
        return deny('secret_change_requires_owner');
      }
      // Non-secret config write: VA configures the workspace on the owner's behalf.
      return allow();
    default:
      return deny('unknown_action');
  }
};
