// agent_defs — agent configuration.
//
// VA permission matrix: the VA may "CONFIGURE AGENTS (agent_defs)" with NO owner
// gate. So:
//   - read/create/update → owner + member + va allow
//   - delete → owner only, AND a builtin def (attrs.source === 'builtin') is protected
//     from deletion entirely (it's a bundled agent, not a tenant-owned row).

import { allow, deny, type Policy } from '../types';

export const agentDefPolicy: Policy = (s, action, r, _env) => {
  switch (action) {
    case 'read':
    case 'create':
    case 'update':
      // VA configures agents on the owner's behalf — no owner gate.
      return allow();
    case 'delete':
      if (r.attrs.source === 'builtin') return deny('cannot_delete_builtin_agent');
      return s.role === 'owner' ? allow() : deny('delete_requires_owner');
    default:
      return deny('unknown_action');
  }
};
