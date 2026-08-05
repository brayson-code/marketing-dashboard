import { NextResponse } from 'next/server';
import { sql } from './db/client';
import { isHqTenant } from './hq-guard';
import { createClient } from './supabase/server';

// Who can run the OPERATOR surfaces — Portal Admin, Industry Templates.
//
// Distinct from requireHq() on purpose. Two different grants:
//   requireHq()       → platform engineering (Issues, Security Console). HQ workspace.
//   requireOperator() → running the business (setting a client up). HQ workspace OR an
//                       entry in platform_operators (migration 0063).
//
// The split exists because Olivia leads Client Success from her own workspace, not from
// HQ, and there is no workspace switcher — so membership of HQ is the wrong question to
// ask about whether someone should be able to onboard a client. It also avoids handing
// Client Success the engineering surfaces just to let them fill in an assistant's hours.
//
// ASYNC, unlike requireHq(): it reads the operator list. Call it with await at the top
// of a handler, after enterTenant().

/** Lowercased email of the authenticated user, or null. */
async function currentEmail(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email;
    return typeof email === 'string' && email ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function isOperator(): Promise<boolean> {
  // HQ membership always counts, so nothing that worked before stops working.
  if (isHqTenant()) return true;

  const email = await currentEmail();
  if (!email) return false;

  try {
    const rows = (await sql()`
      SELECT 1 FROM public.platform_operators WHERE lower(email) = ${email} LIMIT 1
    `) as unknown as unknown[];
    return rows.length > 0;
  } catch {
    // Fail CLOSED. Unlike prep mode, the cost of a wrong answer here is someone
    // reaching a surface that can open a client's workspace.
    return false;
  }
}

/** 403 for non-operators, or null to proceed. */
export async function requireOperator(): Promise<NextResponse | null> {
  return (await isOperator())
    ? null
    : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
