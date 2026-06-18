// drafts / automations — the VA's core operational surface.
//
// VA permission matrix: the VA "content create/edit; CRM/sequences; approve
// automations/drafts; publish" with NO owner gate — it runs the workspace
// autonomously on the owner's behalf. So owner + member + va all act:
//   - read/create/update/approve/reject/publish/send → owner + member + va allow
//   - delete → owner only ("detrimental/irreversible" leans owner-side)
//
// createdBy ownership stays NULL-tolerant: there is no real author_user_id consumer
// day-one (agent_drafts.created_by is agent-authorship TEXT, not a user uuid — ADR
// §6). NULL → "tenant-owned, any member may act" → preserves today's behavior.

import { allow, deny, type Policy } from '../types';

export const draftPolicy: Policy = (s, action, _r, _env) => {
  switch (action) {
    case 'read':
    case 'create':
    case 'update':
    case 'approve':
    case 'reject':
    case 'publish':
    case 'send':
      // owner + member + va — the VA approves/publishes with no owner gate.
      return allow();
    case 'delete':
      return s.role === 'owner' ? allow() : deny('delete_requires_owner');
    default:
      return deny('unknown_action');
  }
};
