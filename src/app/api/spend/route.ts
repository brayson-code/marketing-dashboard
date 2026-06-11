import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { getUsageSummary } from '@/lib/usage';
import { getApifyUsage } from '@/lib/apify';
import { getDeepgramUsage } from '@/lib/deepgram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// External-spend visibility for the Usage page: Claude (derived from our own
// token-cost summary) + Apify + Deepgram (read from each provider's API with the
// tenant's BYO key). Each external provider is isolated so one failing/keyless
// provider returns null without failing the whole route.
export async function GET() {
  enterTenant(await resolveTenant());

  const [claudeRes, apifyRes, deepgramRes] = await Promise.allSettled([
    getUsageSummary(30),
    getApifyUsage(),
    getDeepgramUsage(),
  ]);

  // Claude: total cost USD + total tokens over the last 30d.
  const claude =
    claudeRes.status === 'fulfilled'
      ? {
          usd: claudeRes.value.total.cost_usd,
          tokens: claudeRes.value.total.input_tokens + claudeRes.value.total.output_tokens,
        }
      : { usd: 0, tokens: 0 };

  const apify = apifyRes.status === 'fulfilled' ? apifyRes.value : null;
  const deepgram = deepgramRes.status === 'fulfilled' ? deepgramRes.value : null;

  return NextResponse.json({ claude, apify, deepgram });
}
