'use client';

import { Link2 } from 'lucide-react';
import ConnectPanel from '@/components/connections/connect-panel';
import { IntegrationsPanel } from '@/components/connections/integrations-panel';
import { McpPanel } from '@/components/connections/mcp-panel';

// Single home for everything the workspace connects to:
//  1. Social accounts — one-tap OAuth (Nango) → ConnectPanel
//  2. API keys & other services — credential-based integrations → IntegrationsPanel
// (Replaces the old split between the "Connect" and "Connections" nav tabs.)
export default function ConnectionsPage() {
  return (
    <div className="space-y-6 animate-in">
      <div className="space-y-1">
        <h1 className="text-h1 flex items-center gap-2">
          <Link2 size={18} className="text-primary" /> Connections
        </h1>
        <p className="text-xs text-muted-foreground">
          Connect the accounts and services your agents watch, post to, and act through. Add or remove anytime.
        </p>
      </div>

      <ConnectPanel />

      <div className="border-t border-border/50" />

      <IntegrationsPanel />

      <div className="border-t border-border/50" />

      <McpPanel />
    </div>
  );
}
