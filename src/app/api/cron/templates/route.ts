import { NextRequest, NextResponse } from 'next/server';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  createCronTemplate,
  deleteCronTemplate,
  listCronTemplates,
  updateCronTemplate,
} from '@/lib/cron-templates';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as unknown as Request);
  if (auth) return auth;

  try {
    const actor = requireUser(req as unknown as Request);
    const templates = await listCronTemplates(100);
    const can_write = actor.role === 'admin' || actor.role === 'editor';
    return NextResponse.json({ templates, can_write });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  const actor = requireUser(req as unknown as Request);

  try {
    const body = await req.json().catch(() => ({}));
    const created = await createCronTemplate({
      name: body?.name,
      description: body?.description,
      job: body?.job,
    });

    await logAudit({
      actor,
      action: 'cron_template.create',
      target: `cron_template:${created.id}`,
      detail: { name: created.name },
    });

    return NextResponse.json({ ok: true, template: created });
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    const status = msg === 'Not found' ? 404 : msg.startsWith('Invalid') ? 400 : msg.includes('exists') ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  const actor = requireUser(req as unknown as Request);

  try {
    const body = await req.json().catch(() => ({}));
    const updated = await updateCronTemplate({
      id: body?.id,
      name: body?.name,
      description: body?.description,
      job: body?.job,
    });

    await logAudit({
      actor,
      action: 'cron_template.update',
      target: `cron_template:${updated.id}`,
      detail: { name: updated.name },
    });

    return NextResponse.json({ ok: true, template: updated });
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    const status = msg === 'Not found' ? 404 : msg.startsWith('Invalid') ? 400 : msg.includes('exists') ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireApiEditor(req as unknown as Request);
  if (auth) return auth;
  const actor = requireUser(req as unknown as Request);

  try {
    const id = req.nextUrl.searchParams.get('id');
    await deleteCronTemplate(id);

    await logAudit({
      actor,
      action: 'cron_template.delete',
      target: id ? `cron_template:${id}` : 'cron_template:unknown',
      detail: null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = (error as Error)?.message || String(error);
    const status = msg === 'Not found' ? 404 : msg.startsWith('Invalid') ? 400 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

