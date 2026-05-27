'use client';

import { Plug } from 'lucide-react';
import ConnectPanel from '@/components/connections/connect-panel';

export default function ConnectionsPage() {
  return (
    <div className="space-y-4 animate-in">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Plug size={18} className="text-primary" /> Connections
        </h1>
        <p className="text-xs text-muted-foreground">
          Connect the accounts your agents watch and post to. You can add or remove these anytime.
        </p>
      </div>
      <ConnectPanel />
    </div>
  );
}
