'use client';

import { useEffect, useState } from 'react';
import { Circle } from 'lucide-react';
import { A2AHistory } from '@/components/chat/a2a-history';
import { MissionControlChat } from '@/components/chat/mission-control-chat';

export default function AgentCommsPage() {
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((payload) => setRole(payload?.user?.role === 'admin' ? 'admin' : payload?.user?.role === 'editor' ? 'editor' : 'viewer'))
      .catch(() => setRole('viewer'));
  }, []);

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Agent Comms</h1>
          <p className="text-xs text-muted-foreground">Operator, orchestrator, and agent-to-agent channels.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap justify-end">
          <span className="badge border bg-muted/20 text-muted-foreground">Role: {role}</span>
          <span className="flex items-center gap-1.5"><Circle size={8} className="fill-primary text-primary" /> Live</span>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Comms</h2>
          <p className="text-xs text-muted-foreground">Operational chat channels separated from squad telemetry.</p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <A2AHistory />
          {role === 'admin' ? (
            <MissionControlChat />
          ) : (
            <div className="panel">
              <div className="panel-header">
                <h3 className="section-title">Mission Control (Admin)</h3>
              </div>
              <div className="panel-body">
                <p className="text-xs text-muted-foreground">Available for admin accounts only.</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
