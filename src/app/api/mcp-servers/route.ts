import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import {
  listMcpServers,
  addMcpServer,
  setMcpServerEnabled,
  deleteMcpServer,
} from '@/lib/mcp-store';
import { logAudit } from '@/lib/audit';

// MCP HUB API — manage the tenant's connected remote MCP servers. Auth is
// enforced centrally by the session middleware (src/proxy.ts); RBAC is
// V1-simplified to "the authenticated owner has full access", matching the
// sibling /api/integrations-setup route that also manages encrypted secrets.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET — list connected servers (tokens are masked in mcp-store; only has_auth).
export async function GET() {
  enterTenant(await resolveTenant());
  return NextResponse.json({ servers: await listMcpServers() });
}

// POST — add a server { name, url, auth_token? }. Created disabled (enabled=false).
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  let body: { name?: string; url?: string; auth_token?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!body.url?.trim()) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  try {
    const server = await addMcpServer({ name: body.name, url: body.url, authToken: body.auth_token });
    await logAudit({ actor: null, action: 'mcp.server.add', target: server.name, detail: { id: server.id, url: server.url, has_auth: server.has_auth } }).catch(() => {});
    return NextResponse.json({ ok: true, server });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

// PATCH — toggle enabled { id, enabled }.
export async function PATCH(request: Request) {
  enterTenant(await resolveTenant());
  let body: { id?: number; enabled?: boolean };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (typeof body.id !== 'number') return NextResponse.json({ error: 'id (number) is required' }, { status: 400 });
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 });

  const server = await setMcpServerEnabled(body.id, body.enabled);
  if (!server) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await logAudit({ actor: null, action: body.enabled ? 'mcp.server.enable' : 'mcp.server.disable', target: server.name, detail: { id: server.id } }).catch(() => {});
  return NextResponse.json({ ok: true, server });
}

// DELETE — remove a server. id via ?id= or JSON body.
export async function DELETE(request: Request) {
  enterTenant(await resolveTenant());
  const url = new URL(request.url);
  let id = Number(url.searchParams.get('id'));
  if (!id) {
    try { id = Number(((await request.json()) as { id?: number }).id); } catch { /* no body */ }
  }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  await deleteMcpServer(id);
  await logAudit({ actor: null, action: 'mcp.server.delete', target: String(id), detail: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
