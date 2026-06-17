import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireHq } from '@/lib/hq-guard';
import { listSkills, installSkillToAgent, removeSkillFromAgent, syncSkillsFromGitHub, addCustomSkill, deleteCustomSkill } from '@/lib/skill-library';
import { listAgentDefs } from '@/lib/agent-defs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/skills → the catalog + this workspace's agents (for the install picker).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const [skills, agentDefs] = await Promise.all([listSkills(), listAgentDefs()]);
    const agents = agentDefs
      .filter((a) => a.id !== 'fixer' && a.id !== 'improver')
      .map((a) => ({ id: a.id, name: a.name }));
    return NextResponse.json({ skills, agents });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/skills { action: 'install' | 'remove' | 'sync', slug?, agentId? }
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  let body: { action?: string; slug?: string; agentId?: string; name?: string; category?: string; description?: string; bodyText?: string; bodyUrl?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  try {
    if (body.action === 'add') {
      const skill = await addCustomSkill({ name: body.name ?? '', category: body.category, description: body.description, body: body.bodyText, bodyUrl: body.bodyUrl });
      return NextResponse.json({ ok: true, skill });
    }
    if (body.action === 'delete-skill') {
      if (!body.slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });
      await deleteCustomSkill(body.slug);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'sync') {
      const denied = requireHq();
      if (denied) return denied; // only HQ curates the global catalog
      return NextResponse.json(await syncSkillsFromGitHub());
    }
    if (body.action === 'install') {
      if (!body.slug || !body.agentId) return NextResponse.json({ error: 'slug and agentId are required' }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await installSkillToAgent(body.slug, body.agentId)) });
    }
    if (body.action === 'remove') {
      if (!body.slug || !body.agentId) return NextResponse.json({ error: 'slug and agentId are required' }, { status: 400 });
      await removeSkillFromAgent(body.slug, body.agentId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action. Use install | remove | sync.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
