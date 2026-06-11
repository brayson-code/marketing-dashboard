'use client';

import { useState } from 'react';
import { Clock, Play, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Calendar } from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { timeAgo } from '@/lib/utils';

interface CronJob {
  id: string;
  jobId?: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule?: { kind?: string; expr?: string; tz?: string; at?: string; everyMs?: number; staggerMs?: number };
  payload?: { kind?: string; message?: string; thinking?: string };
  skill?: string;
  state?: { nextRunAtMs?: number };
  lastRun: string | null;
  lastResult: string | null;
}

const AGENT_THEME: Record<string, { color: string; bg: string; emoji: string }> = {
  hermes: { color: 'text-amber-400', bg: 'bg-amber-500/10', emoji: '\u{1F3DB}\u{FE0F}' },
  apollo: { color: 'text-blue-400', bg: 'bg-blue-500/10', emoji: '\u{1F3AF}' },
};

function formatNextRun(ms?: number): string {
  if (!ms) return '';
  const date = new Date(ms);
  const now = Date.now();
  const diff = ms - now;

  if (diff < 0) return 'overdue';
  if (diff < 3600_000) return `in ${Math.ceil(diff / 60_000)}m`;
  if (diff < 86400_000) return `in ${Math.ceil(diff / 3600_000)}h`;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function describeCron(expr: string): string {
  // Simple human-readable cron descriptions
  const parts = expr.split(' ');
  if (parts.length < 5) return expr;
  const [min, hour, , , dow] = parts;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  const dowMap: Record<string, string> = {
    '1-5': 'Weekdays', '1,3,5': 'Mon/Wed/Fri', '2,4': 'Tue/Thu',
    '1': 'Mondays', '5': 'Fridays', '*': 'Daily',
  };
  const dayLabel = dowMap[dow] || `day ${dow}`;
  return `${dayLabel} at ${time}`;
}

function describeSchedule(job: CronJob): string {
  const schedule = job.schedule;
  if (!schedule) return 'No schedule';

  if (schedule.kind === 'every') {
    const everyMs = schedule.everyMs;
    if (!everyMs || everyMs <= 0) return 'Every (invalid interval)';
    if (everyMs < 60_000) return `Every ${Math.max(1, Math.round(everyMs / 1000))}s`;
    if (everyMs < 3_600_000) return `Every ${Math.max(1, Math.round(everyMs / 60_000))}m`;
    return `Every ${Math.max(1, Math.round(everyMs / 3_600_000))}h`;
  }

  if (schedule.kind === 'at') {
    if (!schedule.at) return 'At (missing time)';
    const atDate = new Date(schedule.at);
    if (Number.isNaN(atDate.getTime())) return `At ${schedule.at}`;
    return `At ${atDate.toLocaleString()}`;
  }

  const expr = schedule.expr?.trim();
  const base = expr ? describeCron(expr) : 'Cron schedule';
  if (schedule.staggerMs && schedule.staggerMs > 0) {
    const staggerSeconds = Math.max(1, Math.round(schedule.staggerMs / 1000));
    return `${base} (stagger ${staggerSeconds}s)`;
  }
  return base;
}

export function CronStatus() {
  const [expanded, setExpanded] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const { data: cronData } = useSmartPoll<{ jobs: CronJob[] }>(
    () => fetch('/api/cron').then(r => r.json()),
    { interval: 60_000, enabled: expanded },
  );

  const jobs = cronData?.jobs || [];
  const activeJobs = jobs.filter(j => j.enabled);
  const recentRuns = jobs.filter(j => j.lastRun);

  // Sort: next-to-run first
  const sorted = [...jobs].sort((a, b) => {
    const aNext = a.state?.nextRunAtMs || Infinity;
    const bNext = b.state?.nextRunAtMs || Infinity;
    return aNext - bNext;
  });

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-chart-3/10 flex items-center justify-center">
            <Calendar size={16} className="text-chart-3" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-sm">Scheduled Jobs</h3>
            <p className="text-[11px] text-muted-foreground">
              {activeJobs.length} active
              {recentRuns.length > 0 ? ` · ${recentRuns.length} ran recently` : ' · awaiting first run'}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border/30">
          {sorted.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No cron jobs configured
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {sorted.map(job => {
                const theme = AGENT_THEME[job.agentId] || { color: 'text-muted-foreground', bg: 'bg-muted/10', emoji: '\u{1F916}' };
                const jobId = job.jobId || job.id;
                const isExpanded = expandedJob === jobId;
                const hasRun = !!job.lastRun;
                const nextRun = formatNextRun(job.state?.nextRunAtMs);

                return (
                  <div key={jobId} className="group">
                    <button
                      onClick={() => setExpandedJob(isExpanded ? null : jobId)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors text-left"
                    >
                      {/* Status icon */}
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                        !job.enabled ? 'bg-muted/30' :
                        hasRun ? 'bg-success/10' : 'bg-warning/10'
                      }`}>
                        {!job.enabled ? (
                          <Clock size={12} className="text-muted-foreground" />
                        ) : hasRun ? (
                          <CheckCircle size={12} className="text-success" />
                        ) : (
                          <Play size={12} className="text-warning" />
                        )}
                      </div>

                      {/* Job info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{job.name || jobId}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${theme.bg} ${theme.color}`}>
                            {job.agentId}
                          </span>
                          {job.skill && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground">
                              {job.skill}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-muted-foreground/60">
                            {describeSchedule(job)}
                          </span>
                          {nextRun && (
                            <span className="text-[10px] text-primary/60">
                              · next {nextRun}
                            </span>
                          )}
                          {hasRun && (
                            <span className="text-[10px] text-muted-foreground/40">
                              · ran {timeAgo(job.lastRun!)}
                            </span>
                          )}
                        </div>
                      </div>

                      <ChevronDown size={14} className={`text-muted-foreground/40 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Expanded: show message + last result */}
                    {isExpanded && (
                      <div className="px-5 pb-3 space-y-2">
                        <div className="text-[11px] text-muted-foreground/70 bg-muted/20 rounded-lg p-3">
                          <div className="font-medium text-foreground/80 mb-1">Trigger message:</div>
                          <div className="whitespace-pre-wrap">{job.payload?.message || 'No payload message configured'}</div>
                        </div>
                        {job.lastResult && (
                          <div className="text-[11px] text-muted-foreground/70 bg-muted/20 rounded-lg p-3">
                            <div className="font-medium text-foreground/80 mb-1">Last output:</div>
                            <pre className="whitespace-pre-wrap font-mono text-[10px] max-h-32 overflow-y-auto">{job.lastResult}</pre>
                          </div>
                        )}
                        {!job.lastRun && (
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
                            <AlertCircle size={12} />
                            <span>Awaiting first execution — next run {nextRun}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
