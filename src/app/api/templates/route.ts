// HQ-only Industry Templates API — PREVIEW ONLY. This route cannot write.
//
// Background: agent_library (migration 0058) holds 15 rich archetype agents covering 22
// industries, seeded from keycommand-provisioning's niche-config. Provisioning was meant
// to pick from it; in production every workspace instead carries the same generic roster
// copied from HQ, so none of that library is reaching clients. src/lib/agent-library.ts
// has been a complete read API with no callers since it landed — this is the surface the
// comments there call "the sales console".
//
// This route is DELIBERATELY read-only. Applying a template writes agent_defs into a
// live client workspace, which is a materially different risk and is scoped to a later
// phase with its own sign-off (see plans/niche-templates.md). There is no POST/PATCH
// here on purpose — the preview has to prove the rosters are good before anything is
// written anywhere.
//
// GATING: requireHq() runs BEFORE any query, matching /api/security/console — the
// existing precedent for an intentional cross-tenant operator read. This does NOT use
// the requireApi* helpers: those are no-ops while AUTHZ_ENFORCE is 'off' (the default),
// so they would gate nothing. requireHq is a real 403 regardless of that flag.
//
// Modes (?mode=):
//   niches (default) — every industry + agent counts, plus catalog stats
//   roster           — one industry's agent shortlist (&niche=), optional &tenant= gap
//   agent            — one agent's full prompt bodies (&id=)
//   workspaces       — workspaces to preview a gap against

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireHq } from '@/lib/hq-guard';
import {
  listNiches, agentsForNiche, getLibraryAgent, libraryStats,
  workspaceGap, listWorkspaces,
} from '@/lib/agent-library';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  enterTenant(await resolveTenant());
  const denied = requireHq();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') ?? 'niches';

  try {
    if (mode === 'workspaces') {
      return NextResponse.json({ workspaces: await listWorkspaces() });
    }

    if (mode === 'agent') {
      const id = searchParams.get('id');
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const agent = await getLibraryAgent(id);
      if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      return NextResponse.json({ agent });
    }

    if (mode === 'roster') {
      const niche = searchParams.get('niche');
      if (!niche) return NextResponse.json({ error: 'niche required' }, { status: 400 });
      const agents = await agentsForNiche(niche);

      // The gap is optional — a roster is worth reading on its own, and asking for one
      // against no particular workspace shouldn't cost a second query.
      const tenant = searchParams.get('tenant');
      const gap = tenant ? await workspaceGap(tenant, niche) : null;

      return NextResponse.json({ niche, agents, gap });
    }

    const [niches, stats] = await Promise.all([listNiches(), libraryStats()]);
    return NextResponse.json({ niches, stats });
  } catch (err) {
    console.error('templates route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
