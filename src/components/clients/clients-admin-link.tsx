'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, ArrowUpRight } from 'lucide-react';

// Self-gating entry point to the client-provisioning area. GET /api/clients returns
// 403 for anyone who isn't the platform (HQ) owner, so this card renders only for
// them — no "Clients" surface leaks into client tenants' Settings.
export function ClientsAdminLink() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch('/api/clients', { cache: 'no-store' })
      .then((r) => { if (!cancel) setShow(r.ok); })
      .catch(() => { /* not owner / offline → stay hidden */ });
    return () => { cancel = true; };
  }, []);

  if (!show) return null;

  return (
    <div className="panel p-5 space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2"><Users size={14} className="text-primary" /> Clients</h2>
      <p className="text-xs text-muted-foreground">Provision isolated client workspaces and share invite links.</p>
      <Link href="/clients" className="btn btn-ghost btn-sm w-fit">Manage clients <ArrowUpRight size={13} /></Link>
    </div>
  );
}
