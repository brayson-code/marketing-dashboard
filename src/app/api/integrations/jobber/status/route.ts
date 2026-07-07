import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getJobberTokens, jobberGraphQL } from '@/lib/jobber';
import { jobberConfigured } from '../_shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// TODO-verify: Jobber's exact GraphQL schema for "who am I connected as" isn't in
// the research this build was based on (only the OAuth + versioning contract was
// confirmed against developer.getjobber.com). `account { id name }` is the most
// likely shape for a cheap identity check, but this is a best-effort probe only —
// any shape mismatch, auth failure, or network error is swallowed and we degrade
// to `{ connected: true }` without an account_name rather than ever flipping
// connected to false just because the live probe failed.
const ACCOUNT_NAME_QUERY = `query CommandCenterJobberStatusCheck {
  account {
    id
    name
  }
}`;

// GET /api/integrations/jobber/status → { configured, connected, account_name? }
// `configured` = operator has set JOBBER_CLIENT_ID/SECRET; `connected` = this
// tenant has a stored token. account_name is a best-effort live proof-of-life,
// never required for `connected` to be true.
//
// The probe goes through lib/jobber's jobberGraphQL — the SAME client the agent
// tools use — so token refresh stays on one single-flight code path. A second,
// independent refresh here would race the agent path under Jobber's refresh-token
// rotation (each refresh token is one-time-use).
export async function GET() {
  enterTenant(await resolveTenant());
  const configured = jobberConfigured();

  const tokens = await getJobberTokens();
  if (!tokens) {
    return NextResponse.json({ configured, connected: false });
  }

  let accountName: string | null = null;
  try {
    const data = await jobberGraphQL<{ account?: { name?: string } }>(ACCOUNT_NAME_QUERY);
    accountName = data.account?.name ?? null;
  } catch {
    // Best-effort only — a failed probe never flips connected to false.
  }

  return NextResponse.json({
    configured,
    connected: true,
    account_name: accountName,
  });
}
