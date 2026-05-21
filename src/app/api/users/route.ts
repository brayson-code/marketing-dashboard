import { NextResponse } from 'next/server';
import {
  countOtherAdmins,
  createUser,
  deleteUser,
  getUserRole,
  listUsers,
  requireAdmin,
  resetUserPassword,
  updateUserRole,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Role = 'admin' | 'editor' | 'viewer';

function normalizeRole(value: unknown): Role | null {
  if (value === 'operator') return 'editor';
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value;
  return null;
}

function ensureAnotherAdminExists(excludingUserId: number) {
  if (countOtherAdmins(excludingUserId) <= 0) {
    throw new Error('Cannot remove the last admin');
  }
}

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({ users: listUsers() });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'unauthorized') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (msg === 'forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to list users' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = (await request.json()) as { username?: string; password?: string; role?: string };
    if (!body.username || !body.password) {
      return NextResponse.json({ error: 'username and password required' }, { status: 400 });
    }
    const role: Role = normalizeRole(body.role) ?? 'editor';
    const user = createUser(body.username, body.password, role);
    return NextResponse.json({ user });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'unauthorized') return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (msg === 'forbidden') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    if (msg.includes('UNIQUE')) return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    if (msg.includes('Username') || msg.includes('Password') || msg.includes('Invalid role')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = requireAdmin(request);
    const body = (await request.json()) as { id?: number; role?: string; password?: string };
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    if (body.role) {
      const normalizedRole = normalizeRole(body.role);
      if (!normalizedRole) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      if (admin.id === body.id && normalizedRole !== 'admin') {
        ensureAnotherAdminExists(admin.id);
      }
      updateUserRole(body.id, normalizedRole);
    }

    if (body.password) {
      resetUserPassword(body.id, body.password);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'unauthorized') return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (msg === 'forbidden') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    if (msg.includes('Cannot remove the last admin')) return NextResponse.json({ error: msg }, { status: 400 });
    if (msg.includes('Password') || msg.includes('Invalid role')) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = requireAdmin(request);
    const body = (await request.json()) as { id?: number };
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    if (admin.id === body.id) {
      ensureAnotherAdminExists(admin.id);
    }
    const role = getUserRole(body.id);
    if (role === null) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (role === 'admin') {
      ensureAnotherAdminExists(body.id);
    }
    deleteUser(body.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'unauthorized') return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (msg === 'forbidden') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    if (msg.includes('Cannot remove the last admin')) return NextResponse.json({ error: msg }, { status: 400 });
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
