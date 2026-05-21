/**
 * Next.js instrumentation hook — runs once at server boot.
 * Schedules KeyPlayer's background work:
 *  - proactive sweep (stalled goals, pending drafts, long tasks → owner ping)
 *  - memory compaction (roll up chat history → memory.md)
 *
 * Both are opt-in via env vars. Manual `/api/triggers/*` endpoints work either way.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  schedule({
    label: 'proactive',
    envVar: 'KEYPLAYERS_PROACTIVE_INTERVAL_MIN',
    minIntervalMin: 5,
    run: async () => {
      const { runProactiveSweep } = await import('./src/lib/proactive');
      const r = await runProactiveSweep();
      if (r.invoked) {
        console.log(`[proactive] swept ${r.signals.length} signal(s) — ${r.text ? 'pinged owner' : '(no-op)'}`);
      }
    },
  });

  schedule({
    label: 'memory-compactor',
    envVar: 'KEYPLAYERS_COMPACTOR_INTERVAL_MIN',
    minIntervalMin: 15,
    run: async () => {
      const { spawnSubAgent } = await import('./src/lib/subagent');
      const r = await spawnSubAgent(
        'memory-compactor',
        'Compact the recent boardroom + task activity into a structured rollup using your output schema.',
      );
      if (r.ok) {
        console.log(`[compactor] rollup written (${r.usage?.output ?? '?'} tokens out)`);
      } else {
        console.error('[compactor] failed:', r.error);
      }
    },
  });
}

function schedule(opts: {
  label: string;
  envVar: string;
  minIntervalMin: number;
  run: () => Promise<void>;
}) {
  const minutes = Number(process.env[opts.envVar] ?? 0);
  if (!minutes || minutes < opts.minIntervalMin) {
    console.log(
      `[instrumentation] ${opts.label} scheduler disabled (set ${opts.envVar} >=${opts.minIntervalMin} to enable)`,
    );
    return;
  }
  console.log(`[instrumentation] ${opts.label} scheduler ON — every ${minutes} min`);

  const tick = async () => {
    try {
      await opts.run();
    } catch (err) {
      console.error(`[${opts.label}] tick error:`, (err as Error).message);
    }
  };

  // Stagger first tick by 60s so dev boot is clean.
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), minutes * 60 * 1000);
  }, 60_000);
}
