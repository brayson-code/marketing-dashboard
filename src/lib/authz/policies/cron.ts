// cron — scheduled jobs configuration.
//
// VA permission matrix: the VA may "CONFIGURE CRONS" with NO owner gate (routine
// system ops, run autonomously on the owner's behalf). So owner + member + va may
// read/create/update/delete cron schedules.
//
// NOTE: this governs the cron MANAGEMENT routes (owner's browser, auth-gated). The
// cron RUNNER endpoints (CRON_SECRET, no user subject) skip authorize() entirely
// (ADR §12.7) — do NOT wire this into anything under src/app/api/cron/**.

import { allow, deny, type Policy } from '../types';

export const cronPolicy: Policy = (_s, action, _r, _env) => {
  switch (action) {
    case 'read':
    case 'create':
    case 'update':
    case 'delete':
      return allow();
    default:
      return deny('unknown_action');
  }
};
