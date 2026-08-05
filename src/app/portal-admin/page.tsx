import { notFound } from 'next/navigation';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { isOperator } from '@/lib/operator-guard';
import { PortalAdminPageClient } from './client';

// SERVER gate in front of the operator UI.
//
// The APIs are the real boundary and 403 on their own, but a client-rendered page still
// loaded its shell and then said "not available in this workspace" — which leaks no data
// but does advertise that an admin panel exists. notFound() means a client typing this
// URL gets a 404, the same as any address that was never a page.
//
// Tenant context must be entered here, in the page body, before isOperator() reads it.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PortalAdminPage() {
  enterTenant(await resolveTenant());
  if (!(await isOperator())) notFound();
  return <PortalAdminPageClient />;
}
