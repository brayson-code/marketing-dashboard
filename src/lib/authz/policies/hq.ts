// hq_surface — Issues/Fixer and any cross-client operations surface (ADR §4.4).
//
// HQ_ONLY_TYPES is checked in the dispatcher (deny 'hq_only') BEFORE this runs, so by
// the time we're here s.isHq is true. This re-expresses requireHq() as ONE policy so
// there's a single mental model, WITHOUT changing its semantics. Even within HQ,
// opening a GitHub PR / running the Fixer is owner-gated.

import { allow, deny, type Policy } from '../types';

export const hqSurfacePolicy: Policy = (s, action, _r, _env) => {
  if ((action === 'open_pr' || action === 'run_fixer') && s.role !== 'owner') {
    return deny('hq_write_requires_owner');
  }
  return allow();
};
