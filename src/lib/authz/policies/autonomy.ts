// autonomy — the global agent autonomy level (e.g. flipping to full auto-execute).
//
// CONFLICT RESOLVED (ADR Founder-decision #1 / audit finding #1 vs the VA matrix):
// the audit finding (any member can flip auto-execute) predates the VA matrix. The
// VA matrix allows the VA to "approve automations", but flipping the GLOBAL autonomy
// level to full auto-execute is closer to a system-policy change than a per-draft
// approval. DEFAULT: owner + member allowed, VA blocked. Flagged as Founder-decision
// #6 to confirm.

import { allow, deny, type Policy } from '../types';

export const autonomyPolicy: Policy = (s, action, _r, _env) => {
  switch (action) {
    case 'read':
      return allow();
    case 'update':
      if (s.role === 'owner' || s.role === 'member') return allow();
      return deny('autonomy_level_requires_owner_or_member');
    default:
      return deny('unknown_action');
  }
};
