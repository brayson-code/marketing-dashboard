import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';

function isGoogleEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim() &&
    process.env.GOOGLE_REDIRECT_URI?.trim(),
  );
}

export async function GET() {
  enterTenant(await resolveTenant());
  return NextResponse.json({
    google: isGoogleEnabled(),
  });
}

