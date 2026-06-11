import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { requireApiUser } from '@/lib/api-auth';
import { getHermesStateDir } from '@/lib/hermes-state';

const STATE_DIR = getHermesStateDir();

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(request as Request);
  if (auth) return auth;
  const budgetPath = path.join(STATE_DIR, 'x-api-budget.json');

  try {
    if (!fs.existsSync(budgetPath)) {
      return NextResponse.json({
        date: new Date().toISOString().split('T')[0],
        calls: 0,
        posts: 0,
        daily_search_limit: 15,
        daily_post_limit: 5,
        search_remaining: 15,
        post_remaining: 5,
        queries: [],
        posted: [],
      });
    }

    const raw = fs.readFileSync(budgetPath, 'utf-8');
    const budget = JSON.parse(raw);
    const today = new Date().toISOString().split('T')[0];

    // Reset if stale (different day)
    if (budget.date !== today) {
      return NextResponse.json({
        date: today,
        calls: 0,
        posts: 0,
        daily_search_limit: 15,
        daily_post_limit: 5,
        search_remaining: 15,
        post_remaining: 5,
        queries: [],
        posted: [],
      });
    }

    return NextResponse.json({
      date: budget.date,
      calls: budget.calls || 0,
      posts: budget.posts || 0,
      daily_search_limit: 15,
      daily_post_limit: 5,
      search_remaining: Math.max(0, 15 - (budget.calls || 0)),
      post_remaining: Math.max(0, 5 - (budget.posts || 0)),
      queries: (budget.queries || []).slice(-10), // last 10 queries
      posted: (budget.posted || []).slice(-5), // last 5 posts
    });
  } catch {
    return NextResponse.json({ error: 'Failed to read budget' }, { status: 500 });
  }
}

