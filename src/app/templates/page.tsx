import { notFound } from 'next/navigation';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { isOperator } from '@/lib/operator-guard';
import { TemplatesPageClient } from './client';

// SERVER gate — see portal-admin/page.tsx for the reasoning. A non-operator gets a 404
// rather than a page that renders and then tells them they are not allowed.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function TemplatesPage() {
  enterTenant(await resolveTenant());
  if (!(await isOperator())) notFound();
  return <TemplatesPageClient />;
}
